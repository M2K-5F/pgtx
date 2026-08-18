import { Socket } from "net"
import { nextTick } from "process"
import { ConnectionRequestWriter } from "./protocol/connection-request-writer"
import { createAuthorizedSocket } from "./protocol/socket-authorization"
import { ResponseType, ResponseTypes, TransactionStatuses } from "./protocol/constants"
import { ConnectionResponseReader } from "./protocol/connection-response-reader"
import { compileSqlTemplate } from "./utils/template-compiler"
import { Branded, ColumnDescription } from "./types"
import { Transaction } from "./transaction"
import { SocketConnector } from "./protocol/socket-connector"
import { Queue, RingQueue } from "./queue"
import { Query, QueryState, State, StreamQuery } from "./query"
import { sql } from "."
import { Begin, Future, Ok } from 'fluent-future'
import { PostgresError } from "./error"
import { ReadableStreamDefaultController } from "stream/web"

type LogLevel = "none" | "error" | "notice" | "query"

export type ConnectionParams = {
    user: string
    password?: string
    host: string
    port: number
    database: string
    logLevel?: LogLevel,
    int8toBigint?: boolean,
    queryTimeout?: number
    batchCapacity?: number,
    flushShedule?: "nextTick" | "Immediate"
}


const ErrBatchOverflowed = new PostgresError(
    `BatchOverflowError: Connection queue capacity exceeded.
    Please increase the batch capacity parameter in your connection config.`
)
const ErrConnectionClosed = new PostgresError("Connection is closed", 'connection_closed', "", "ERROR")
const ErrConnectionReconnecting = new PostgresError("Connection are reconnecting", "connection_reconnecting", "", "ERROR")


type QueryBatch = RingQueue<Query<any> | StreamQuery<any>>

export type StatementName = Branded<string, 'StatementName'>

export type QueryText = Branded<string, 'QueryText'>

export type ChannelName = Branded<string, "ChannelName">

export type QueryMeta = {
    statement: StatementName
    columns: ColumnDescription[]
}

/**
 * Represents a single dedicated connection to the PostgreSQL database.
 * 
 * Supports:
 * - Tagged template queries with automatic parameter binding
 * - Prepared statements with caching
 * - Transaction management with savepoints
 * - Pipeline execution for concurrent queries
 * 
 * @example
 * ```ts
 * const conn = await Connection.new({
 *   host: 'localhost',
 *   user: 'postgres',
 *   password: 'postgres',
 *   database: 'test'
 * })
 * 
 * // Simple query
 * const users = await conn.query`SELECT * FROM users WHERE id = ${1}`
 * 
 * // Transaction
 * await conn.begin(async tx => {
 *   await tx.query`INSERT INTO users ...`
 * })
 * 
 * // Close connection
 * conn.close()
 * ```
 */
export class Connection {
    private readonly params: ConnectionParams
    private _isFlushing = false
    private _isOpened = true
    private _isReconnecting = false
    private _socket: SocketConnector
    private _writer: ConnectionRequestWriter

    private _batchQueue: Queue<QueryBatch> = new Queue()

    private _parsed = new Map<QueryText, QueryMeta>()
    private _parsing = new Map<QueryText, StatementName>()

    private _listeningCallbacks = new Map<ChannelName, Set<(payload: string) => void>>()
    private _stmtCounter = 0
    private _logLevel: LogLevel


    private _nextStatement() {
        return `s-${this._stmtCounter++}` as StatementName
    }


    private constructor(
        socket: Socket,
        writer: ConnectionRequestWriter,
        logLevel: LogLevel, 
        params: ConnectionParams
    ) {
        this.params = params
        this._logLevel = logLevel
        this._socket = new SocketConnector(socket, 
            (type, _, reader) => this._handlePacket(type, reader),
            (err) => {
                // console.log(err)
                this._registerReconnect()
            }
        )
        this._writer = writer
    }


    /**
     * Creates a new database connection.
     * 
     * @param params - Connection parameters
     * @returns A new Connection instance
     * @throws {PostgresError} If authentication fails or connection cannot be established
     * 
     * @example
     * ```ts
     * const conn = await Connection.new({
     *   host: 'localhost',
     *   port: 5432,
     *   user: 'postgres',
     *   password: 'secret',
     *   database: 'myapp'
     * })
     * ```
     */
    static new(params: ConnectionParams) {
        const writer = ConnectionRequestWriter.new()
        return createAuthorizedSocket(writer, params)
            .andThen(socket => Ok(new Connection(socket, writer, params.logLevel || 'error', params)))
    }


    /**
     * Executes a query using tagged template literals.
     * 
     * Parameters are automatically bound to `$1, $2, ...` placeholders.
     * Queries with parameters use prepared statements for performance.
     * 
     * @param templates - Tagged template string with SQL
     * @param args - Query parameters
     * @returns Array of rows with proper typing
     * @throws {Error} If connection is dead or query fails
     * 
     * @example
     * ```ts
     * // Simple query
     * const users = await conn.query`SELECT * FROM users`
     * 
     * // With parameters
     * const user = await conn.query`SELECT * FROM users WHERE id = ${1}`
     * 
     * // With typed result
     * type User = { id: number, name: string }
     * const users = await conn.query<User>`SELECT * FROM users`
     * ```
     */
    query<T extends Record<string, any>>(templates: TemplateStringsArray, ...params: any[]): Future<T[], PostgresError> {
        if (!this._isOpened) return Future.reject(ErrConnectionClosed)
        if (this._isReconnecting) return Future.reject(ErrConnectionReconnecting)

        const {text, args} = compileSqlTemplate(templates, params) as {text: QueryText, args: (string | null)[]}
        
        if (this._logLevel === 'query') {
            console.log(`\nQUERY:     ${text}\n${args.length !== 0 ? `ARGUMENTS: [${args}]\n` : ""}`)
        }

        const query = this._createQuery<T>(text, args)

        if (this._writeQuery(query)) return Future.reject(ErrBatchOverflowed)

        query.startTimeout(this.params.queryTimeout || 30000)
        return query
    }


    /**
     * Starts a managed transaction on this connection.
     * 
     * Automatically handles:
     * - `BEGIN` before the callback
     * - `COMMIT` on successful completion
     * - `ROLLBACK` if an error is thrown
     * 
     * @param txCallback - Async function that receives a `Transaction` instance
     * @returns The value returned from the callback
     * @throws {Error} If connection is dead or transaction fails
     * 
     * @example
     * ```ts
     * const result = await conn.begin(async tx => {
     *   await tx.query`INSERT INTO accounts (id, balance) VALUES (1, 100)`
     *   await tx.query`UPDATE accounts SET balance = balance - 10 WHERE id = 1`
     *   return { success: true }
     * })
     * ```
     */
    begin<T>(txCallback: (transaction: Transaction) => Promise<T>) {
        if (!this._isOpened) return Future.reject(ErrConnectionClosed)
        if (this._isReconnecting) return Future.reject(ErrConnectionReconnecting)

        const tx = new Transaction(this)

        return Begin()
            .andThen(() => tx.query`BEGIN`)    
            .andThen(() => 
                Future.of(txCallback(tx))
                    .tap(() => {
                        if (tx.isActive) return tx.commit()
                    })
                    .tapErr(() => {
                        if (tx.isActive) return tx.rollback()
                    })
            )
    }


    /**
     * Sends an asynchronous notification to a channel via `pg_notify`.
     * 
     * @param channelName - The channel identifier
     * @param payload - Optional string data (max 8000 bytes)
     * 
     * @example
     * ```ts
     * await conn.notify('events', 'hello')
     * ```
     */
    notify(channelName: string, payload: string = "") {
        if (!this._isOpened) return Future.reject(ErrConnectionClosed)
        if (this._isReconnecting) return Future.reject(ErrConnectionReconnecting)

        return this.query`select pg_notify(${channelName}, ${payload})`
    }


    /**
     * Subscribes a callback to a channel. Sends `LISTEN` on the first subscription.
     * 
     * @param channelName - The channel identifier
     * @param callback - Function invoked when a notification arrives
     * 
     * @example
     * ```ts
     * await conn.listen('events', data => console.log(data))
     * ```
     */
    listen(channelName: string, callback: (payload: string) => void) {
        if (!this._isOpened) return Future.reject(ErrConnectionClosed)
        if (this._isReconnecting) return Future.reject(ErrConnectionReconnecting)

        if (!this._listeningCallbacks.has(channelName as ChannelName)) {
            this._listeningCallbacks.set(channelName as ChannelName, new Set())
        }

        const callbackSet = this._listeningCallbacks.get(channelName as ChannelName)!

        callbackSet.add(callback)

        return this.query`listen ${sql.ident(channelName)};`.map(() => {})
    }


    /**
     * Unsubscribes a callback. Sends `UNLISTEN` if no callbacks remain for the channel.
     * 
     * @param channelName - The channel identifier
     * @param callback - The registered callback to remove
     * 
     * @example
     * ```ts
     * await conn.unlisten('events', callback)
     * ```
     */
    unlisten(channelName: string, callback: (payload: string) => void): Future<void, PostgresError> {
        if (!this._isOpened) return Future.reject(ErrConnectionClosed)
        if (this._isReconnecting) return Future.reject(ErrConnectionReconnecting)

        if (!this._listeningCallbacks.has(channelName as ChannelName)) {
            return Ok()
        }

        const callbackSet = this._listeningCallbacks.get(channelName as ChannelName)!

        callbackSet.delete(callback)

        if (callbackSet.size === 0) {
            this._listeningCallbacks.delete(channelName as ChannelName)
            return this.query`unlisten ${sql.ident(channelName)};`.map(() => {})
        }
        
        return Ok()
    }


    /**
     * Executes an SQL query in streaming mode.
     * 
     * Data is streamed directly from the PostgreSQL binary network buffer into the Web Streams API 
     * (`ReadableStream`), bypassing any intermediate array allocation or row accumulation in the JS heap.
     * This pattern provides a true Zero-Memory Footprint and is ideal for exporting massive tables 
     * or piping database payloads directly into HTTP responses (e.g., via `Bun.serve` or fetch `Response`).
     *
     * @template T The expected shape of a single row interface.
     * @param {TemplateStringsArray} templates The SQL string parts from the tagged template literal.
     * @param {...any} args The parameterized query arguments.
     * @returns {ReadableStream<T>} Synchronously returns a native Web ReadableStream instance.
     * 
     * @example
     * // Streaming a giant table directly to an HTTP response (Bun.serve)
     * const userStream = conn.stream<User>`SELECT id, name FROM users`;
     * return new Response(userStream, { headers: { 'Content-Type': 'application/json' } });
     * 
     * @example
     * // Asynchronously iterating over rows as they arrive from the wire socket
     * const stream = conn.stream<User>`SELECT * FROM orders WHERE status = ${'processed'}`;
     * for await (const row of stream) {
     *     console.log(row.id, row.amount); // Row object is eligible for GC immediately after iteration
     * }
     */
    stream<T extends Record<string, any>>(templates: TemplateStringsArray, ...params: any[]) {
        if (!this._isOpened) throw ErrConnectionClosed
        if (this._isReconnecting) throw ErrConnectionReconnecting 

        const {text, args} = compileSqlTemplate(templates, params) as {text: QueryText, args: (string | null)[]}
        
        if (this._logLevel === 'query') {
            console.log(`\nQUERY:     ${text}\n${args.length !== 0 ? `ARGUMENTS: [${args}]\n` : ""}`)
        }

        let controller!: ReadableStreamDefaultController<T>

        const stream = new ReadableStream<T>({
            start: c => {
                controller = c
            }
        })
        

        const query = this._createStream<T>(text, args, controller)

        if (this._writeQuery(query)) throw ErrBatchOverflowed

        query.startTimeout(this.params.queryTimeout || 30000)
        return stream
    }
    

    private _streamWithController<T extends Record<string, any>>(templates: TemplateStringsArray, params: any[], controller: ReadableStreamDefaultController<T>) {
        if (!this._isOpened) throw ErrConnectionClosed
        if (this._isReconnecting) throw ErrConnectionReconnecting 

        const {text, args} = compileSqlTemplate(templates, params) as {text: QueryText, args: (string | null)[]}
        
        if (this._logLevel === 'query') {
            console.log(`\nQUERY:     ${text}\n${args.length !== 0 ? `ARGUMENTS: [${args}]\n` : ""}`)
        }
        
        const query = this._createStream<T>(text, args, controller)

        if (this._writeQuery(query)) throw ErrBatchOverflowed

        query.startTimeout(this.params.queryTimeout || 30000)
        
        return query
    }
    
    
    private _createQuery<T>(text: QueryText, args: (string | null)[]) {
        if (this._parsed.has(text)) {
            const meta = this._parsed.get(text)!

            return new Query<T>(
                text, args, 
                QueryState.Executing, 
                meta.statement,
                meta.columns
            )
        }

        else {
            if (this._parsing.has(text)) {
                const statementName = this._parsing.get(text)!
                return new Query<T>(
                    text, args,
                    QueryState.Executing,
                    statementName,
                )
            }
            else {
                const statementName = this._nextStatement()
                this._parsing.set(text, statementName)
                return new Query<T>(
                    text, args,
                    QueryState.Parsing,
                    statementName,
                )
            }
        }
    }


    private _createStream<T>(text: QueryText, args: (string | null)[], controller: ReadableStreamDefaultController<T>) {
        if (this._parsed.has(text)) {
            const meta = this._parsed.get(text)!

            return new StreamQuery<T>(
                text, args, 
                QueryState.Executing, 
                meta.statement,
                controller,
                meta.columns
            )
        }

        else {
            if (this._parsing.has(text)) {
                const statementName = this._parsing.get(text)!
                return new StreamQuery<T>(
                    text, args,
                    QueryState.Executing,
                    statementName,
                    controller
                )
            }
            else {
                const statementName = this._nextStatement()
                this._parsing.set(text, statementName)
                return new StreamQuery<T>(
                    text, args,
                    QueryState.Parsing,
                    statementName,
                    controller
                )
            }
        }
    }


    private _writeQuery(query: Query<any> | StreamQuery<any>) {        
        const batch = this._registerFlush()

        if (batch.isFull) return true

        batch.push(query)
        
        if (query.state === QueryState.Parsing) {
            this._writer
                .writeParse(query.statementName, query.text)
                .writeDescribe(query.statementName)
        }
        
        this._writer
            .writeBind("", query.statementName, query.args)
            .writeExecute("")
        
    }


    private _registerFlush() {
        if (!this._isFlushing) {
            this._isFlushing = true

            const batch: QueryBatch = new RingQueue<Query<any>>(this.params.batchCapacity)
            this._batchQueue.push(batch)

            // this.params.flushShedule === 'nextTick'
                // ? nextTick(() => this._flush()) 
                // : setImmediate(() => this._flush())
            setTimeout(() => this._flush())
            return batch
        }

        return this._batchQueue.last
    }


    private _flush() {      
        if (!this._isOpened) {
            this._rejectAllBatches(ErrConnectionClosed)
            return
        }

        if (this._isReconnecting) {
            this._reconnect()
                .then(() => {
                    this._isFlushing = false
                    void this._restoreSubscriptions()
                    
                    this._socket.write(this._writer.writeSync())
                    this._writer.clear()
                })
                .then(() => {
                    this._isReconnecting = false
                })
        }

        else {
            this._socket.write(this._writer.writeSync())
            this._writer.clear()
            
            this._isFlushing = false
        }
    }

    
    private _registerReconnect() {
        if (this._isReconnecting) return
        this._isReconnecting = true
        console.log('reconnect registered');
        
        this._rejectAllBatches(ErrConnectionReconnecting)
        this._writer.clear()     
    }


    private _resetConnectionState(cause: PostgresError) {
        this._parsed.clear()
        this._parsing.clear()
        this._writer.clear()
        
        this._rejectAllBatches(cause)
    }
    

    private async _reconnect() {
        console.log('reconnecting')

        const socket = await createAuthorizedSocket(ConnectionRequestWriter.new(), this.params)

        const connector = new SocketConnector(
            socket, 
            (type, _ ,reader) => this._handlePacket(type, reader),
            (err) => this._registerReconnect()
        )

        this._socket = connector
        
        this._resetConnectionState(ErrConnectionReconnecting)
    }

    
    private _restoreSubscriptions() {
        if (this._listeningCallbacks.size === 0) return Promise.resolve()

        const promises = Array.from(this._listeningCallbacks.keys()).map(channel => {
            return this.query`LISTEN ${sql.ident(channel)};`
        })

        return Promise.all(promises)
    }


    private _getCurrentQuery() {
        return this._batchQueue.current.current
    }


    private _rejectCurrentBatch(error: PostgresError) {
        const queue = this._batchQueue.current

        while (queue.hasMore) {
            queue.shift.reject(error)
        }
    }


    private _rejectAllBatches(error: PostgresError) {
        while (this._batchQueue.hasMore) {
            const batch = this._batchQueue.shift

            while (batch.hasMore) {
                batch.shift.reject(error)
            }
        }
    }


    private _handlePacket(type: ResponseType, reader: ConnectionResponseReader) {
        switch (type) {
            case ResponseTypes.ParseComplete: {
                reader.readParseComplete()
            } break


            case ResponseTypes.BindComplete: {
                reader.readBindComplete()
                const query = this._getCurrentQuery()

                if (!query.columns) {
                    query.columns = this._parsed.get(query.text)?.columns
                }
            } break


            case ResponseTypes.CloseComplete: {
                reader.readBindComplete()
            } break


            case ResponseTypes.ParameterDescription: {
                reader.readParameterDescription()
            } break


            case ResponseTypes.NoData: {
                reader.readNoData()

                const query = this._getCurrentQuery()
                this._parsing.delete(query.text)
                this._parsed.set(query.text, {statement: query.statementName, columns: []})
                query.state = QueryState.Executing
                query.columns = []
            } break


            case ResponseTypes.RowDescription: {
                const columns = reader.readRowDescription()

                const query = this._getCurrentQuery()
                this._parsing.delete(query.text)
                this._parsed.set(query.text, {statement: query.statementName, columns: columns})
                query.state = QueryState.Executing
                query.columns = columns
            } break


            case ResponseTypes.DataRow: {
                let query = this._getCurrentQuery()

                query.push(reader.readDataRow(query.columns!, this.params.int8toBigint))
            } break


            case ResponseTypes.ComandComplete: {
                reader.readCommandComplete()

                if (this._batchQueue.isFree) {
                    this.close()
                    break
                }

                const query = this._getCurrentQuery()
                
                if (!query) {
                    this.close()
                    break
                }

                query.state = QueryState.Completed
                
                query.resolve()
                
                this._batchQueue.current.next()
            } break


            case ResponseTypes.ErrorResponse: {
                const error = reader.readErrorResponse()

                if (this._logLevel === 'error' || this._logLevel === 'notice' || this._logLevel === 'query') {
                    console.log(`\nError:    ${error}\n`)
                }

                const query = this._getCurrentQuery()

                this._parsing.delete(query.text)

                query.state = QueryState.Failed

                this._rejectCurrentBatch(error)
            } break


            case ResponseTypes.ReadyForQuery: {
                reader.readReadyForQuery()
                
                this._batchQueue.next()
            } break


            case ResponseTypes.Notice: {
                const message = reader.readErrorResponse()
                
                if (this._logLevel === 'notice' || this._logLevel === 'query') {
                    console.log(`\nError:    ${message}\n`)
                }
            } break


            case ResponseTypes.NotificationResponse: {
                const {name, payload} = reader.readNotificationResponse()

                const callbackSet = this._listeningCallbacks.get(name)

                if (!callbackSet) break

                callbackSet.forEach(cb => cb(payload))
            } break


            default: console.warn('Undeclared response type: ', type);
        }
    }


    /**
     * Checks if the connection is still alive and usable.
     * Returns `false` if the socket is destroyed or connection is dead.
     */
    get isOpened() {
        return this._isOpened
    }


    /**
     * Closes the connection immediately.
     * All pending queries will be rejected with an error.
     * The connection cannot be used after this call.
     * 
     * @example
     * ```ts
     * conn.close()
     * ```
     */
    close() {
        this._isOpened = false
        this._socket.destroy()
        this._rejectAllBatches(ErrConnectionClosed)
    }
}
