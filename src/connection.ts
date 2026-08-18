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
import { ParseQuery, Query, QueryState, SimpleQuery, State, StreamQuery } from "./query"
import { sql } from "."
import { Begin, Future, Ok } from 'fluent-future'
import { ErrConnectionClosed, ErrConnectionReconnecting, PostgresError } from "./error"
import { ReadableStreamDefaultController } from "stream/web"
import { Batch } from "./batch"

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

    private _activeBatch: Batch | null = null
    private _isOpened = true
    private _isReconnecting = false

    private _socket: SocketConnector

    private _batchQueue: Queue<Batch> = new Queue()

    private _parsed = new Map<QueryText, QueryMeta>()
    private _parsing = new Map<QueryText, Future<QueryMeta, PostgresError>>()

    private _listeningCallbacks = new Map<ChannelName, Set<(payload: string) => void>>()
    private _stmtCounter = 0
    private _logLevel: LogLevel


    private _nextStatement() {
        return `s-${this._stmtCounter++}` as StatementName
    }


    private constructor(
        socket: Socket,
        logLevel: LogLevel, 
        params: ConnectionParams
    ) {
        this.params = params
        this._logLevel = logLevel
        this._socket = new SocketConnector(socket, 
            (type, _, reader) => this._handlePacket(type, reader),
            () => this._registerReconnect()
        )
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
            .andThen(socket => Ok(new Connection(socket, params.logLevel || 'error', params)))
    }


    private _registerBatch() {
        if (!this._activeBatch) {
            const batch = new Batch()
            this._activeBatch = batch
            setImmediate(() => {
                this._sync(batch)
            })

            return batch
        }

        return this._activeBatch
    }


    private _sync(batch: Batch) {
        if (!this._isOpened) {
            batch.reject(ErrConnectionClosed)
            return
        }

        if (this._isReconnecting) {
            this._reconnect()
                .then(() => {
                    this._activeBatch = null
                    void this._restoreSubscriptions()


                    
                    this._socket.write(this._registerBatch().end())
                    this._batchQueue.push(this._registerBatch())
                })
                .then(() => {
                    this._isReconnecting = false
                })
        }

        this._socket.write(batch.end())
        this._activeBatch = null
        this._batchQueue.push(batch)
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

        const batch = this._registerBatch()

        if (this._parsed.has(text)) {
            const meta = this._parsed.get(text)!
            
            const query = new SimpleQuery<T>(
                meta.statement, text, args, meta.columns
            )
            batch.registerQuery(query, this.params.queryTimeout || 30000)
            
            return query.future
        }

        if (!this._parsing.has(text)) {
            const parseQuery = new ParseQuery(this._nextStatement(), text)

            this._parsing.set(text, parseQuery.future)

            batch.registerQuery(parseQuery, this.params.queryTimeout || 30000)
        }

        const future = this._parsing.get(text)!
        

        return future.andThen(meta => {
            const query = new SimpleQuery<T>(
                meta.statement, text, args, meta.columns
            )
            this._registerBatch().registerQuery(query, this.params.queryTimeout || 30000)
            
            return query.future
        })
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

        const batch = this._registerBatch()

        if (this._parsed.has(text)) {
            const meta = this._parsed.get(text)!
            const query = new StreamQuery<T>(
                meta.statement, text, args, controller, meta.columns
            )
            batch.registerQuery(query, this.params.queryTimeout || 30000)
            
            return stream
        }

        if (!this._parsing.has(text)) {
            const parseQuery = new ParseQuery(this._nextStatement(), text)

            this._parsing.set(text, parseQuery.future)

            batch.registerQuery(parseQuery, this.params.queryTimeout || 30000)
        }

        const future = this._parsing.get(text)!

        future
            .tap(meta => {
                const query = new StreamQuery<T>(
                    meta.statement, text, args, controller, meta.columns
                )
                this._registerBatch().registerQuery(query, this.params.queryTimeout || 30000)
            })
            .catch(err => 
                controller.error(err)
            )
        
        return stream
    }
    

    private _streamWithController<T extends Record<string, any>>(templates: TemplateStringsArray, params: any[], controller: ReadableStreamDefaultController<T>) {
        if (!this._isOpened) throw ErrConnectionClosed
        if (this._isReconnecting) throw ErrConnectionReconnecting 

        const {text, args} = compileSqlTemplate(templates, params) as {text: QueryText, args: (string | null)[]}
        
        if (this._logLevel === 'query') {
            console.log(`\nQUERY:     ${text}\n${args.length !== 0 ? `ARGUMENTS: [${args}]\n` : ""}`)
        }


        const batch = this._registerBatch()

        if (this._parsed.has(text)) {
            const meta = this._parsed.get(text)!
            const query = new StreamQuery<T>(
                meta.statement, text, args, controller, meta.columns
            )
            batch.registerQuery(query, this.params.queryTimeout || 30000)
        }

        if (!this._parsing.has(text)) {
            const parseQuery = new ParseQuery(this._nextStatement(), text)

            this._parsing.set(text, parseQuery.future)

            batch.registerQuery(parseQuery, this.params.queryTimeout || 30000)
        }

        const future = this._parsing.get(text)!

        future
            .tap(meta => {
                const query = new StreamQuery<T>(
                    meta.statement, text, args, controller, meta.columns
                )
                this._registerBatch().registerQuery(query, this.params.queryTimeout || 30000)
            })
            .catch(err => 
                controller.error(err)
            )
    }

    
    private _registerReconnect() {
        if (this._isReconnecting) return
        this._isReconnecting = true
    }


    private _resetConnectionState(cause: PostgresError) {
        this._parsed.clear()
        this._parsing.clear()
        this._activeBatch = null
        
        this._rejectAllBatches(cause)
    }
    

    private async _reconnect() {

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


    private _rejectAllBatches(cause: PostgresError) {
        while (this._batchQueue.hasMore) {
            this._batchQueue.shift.reject(cause)
        }
    }


    private _handlePacket(type: ResponseType, reader: ConnectionResponseReader) {
        switch (type) {
            case ResponseTypes.ParseComplete: {
                reader.readParseComplete()
            } break


            case ResponseTypes.BindComplete: {
                reader.readBindComplete()
            } break


            case ResponseTypes.CloseComplete: {
                reader.readBindComplete()
            } break


            case ResponseTypes.ParameterDescription: {
                reader.readParameterDescription()
            } break


            case ResponseTypes.NoData: {
                reader.readNoData()
                
                const query = this._getCurrentQuery() as ParseQuery
                
                const meta = {statement: query.statement, columns: []}
                
                this._parsing.delete(query.text)
                query.resolve(meta)
                this._parsed.set(query.text, meta)
                this._batchQueue.current.next()
            } break


            case ResponseTypes.RowDescription: {
                const columns = reader.readRowDescription()

                const query = this._getCurrentQuery() as ParseQuery
                
                const meta = {statement: query.statement, columns}
                
                this._parsing.delete(query.text)
                query.resolve(meta)
                this._parsed.set(query.text, meta)
                this._batchQueue.current.next()
            } break



            case ResponseTypes.DataRow: {
                let query = this._getCurrentQuery() as StreamQuery<any> | SimpleQuery<any>

                query.push(reader.readDataRow(query.columns!, this.params.int8toBigint))
            } break


            case ResponseTypes.ComandComplete: {
                reader.readCommandComplete()

                const query = this._getCurrentQuery() as StreamQuery<any> | SimpleQuery<any>
                
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


                this._batchQueue.current.reject(error)
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


            default: console.log('Undeclared response type: ', type);
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
