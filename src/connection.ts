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
import { Queue } from "./queue"
import { Query, QueryState } from "./query"
import { sql } from "."
import {Begin, Future, Resolve} from 'fluent-future'
import { PostgresError } from "./error"

type LogLevel = "none" | "error" | "notice" | "query"

export type ConnectionParams = {
    user: string
    password?: string
    host: string
    port: number
    database: string
    logLevel?: LogLevel,
    int8toBigint?: boolean
}

const ErrConnectionClosed = new PostgresError("Connection is closed", 'connection_closed', "", "ERROR")
const ErrConnectionReconnecring = new PostgresError("Connection are reconnecting", "connection_reconnecting", "", "ERROR")


export type ExecuteQueueUnit = {
    rows: (string | null)[][]
    resolve: (value: any) => void
    reject: (err: Error) => void
    statementName: StatementName
}


export type ParsingQueueUnit = {
    resolve: (statementName: StatementName) => void
    reject: (error: Error) => void
    text: QueryText
    statementName: StatementName
}


export type DescribeQueueUnit = {
    resolve: (value: ColumnDescription[]) => void
    reject: (error: Error) => void
    statementName: StatementName
}


type Pipeline = Queue<Query<any>>

export type StatementName = Branded<string, 'StatementName'>

export type QueryText = Branded<string, 'QueryText'>

export type ChannelName = Branded<string, "ChannelName">


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

    private _pipelinesQueue = new Queue<Pipeline>()

    private _described = new Map<StatementName, ColumnDescription[]>()
    private _describingPending = new Set<StatementName>()
    private _parsed = new Map<QueryText, StatementName>()
    private _parsingPending = new Map<QueryText, StatementName>()

    private _listeningCallbacks = new Map<ChannelName, Set<(payload: string) => void>>()
    private _stmtCounter = 0
    private _logLevel: LogLevel


    private _nextStatement() {
        return `s-${this._stmtCounter++}` as StatementName
    }


    private _checkOpened() {
        if (!this.isOpened) throw ErrConnectionClosed
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
            (type, reader) => this._handlePacket(type, reader),
            (err) => this._registerReconnect()
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
            .andThen(socket => Resolve(new Connection(socket, writer, params.logLevel || 'error', params)))
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
    query<T extends Record<string, any>>(templates: TemplateStringsArray, ...params: any[]) {
        this._checkOpened()
        this._registerFlush()

        const {text, args} = compileSqlTemplate({templates, args: params}) as {text: QueryText, args: (string | null)[]}
        
        if (this._logLevel === 'query') {
            console.log(`\nQUERY:     ${text}\n${args.length !== 0 ? `ARGUMENTS: [${args}]\n` : ""}`)
        }

        const query = this._createQuery<T>(text, args)

        this._writeQuery(query)
    
        return Future.of(query.promise, error => {
            if (error instanceof PostgresError) return error

            return new PostgresError(error.message)
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
        this._checkOpened()

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
        this._checkOpened()
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
        this._checkOpened()
        if (!this._listeningCallbacks.has(channelName as ChannelName)) {
            this._listeningCallbacks.set(channelName as ChannelName, new Set())
        }

        const callbackSet = this._listeningCallbacks.get(channelName as ChannelName)!

        callbackSet.add(callback)

        return this.query`listen ${sql.ident(channelName)};`
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
    unlisten(channelName: string, callback: (payload: string) => void): Future<[], PostgresError> {
        this._checkOpened()
        if (!this._listeningCallbacks.has(channelName as ChannelName)) {
            return Resolve([])
        }

        const callbackSet = this._listeningCallbacks.get(channelName as ChannelName)!

        callbackSet.delete(callback)

        if (callbackSet.size === 0) {
            this._listeningCallbacks.delete(channelName as ChannelName)
            return this.query`unlisten ${sql.ident(channelName)};` as Future<[], PostgresError>
        }
        
        return Resolve([])
    }
    
    
    private _createQuery<T>(text: QueryText, args: (string | null)[]): Query<T> {
        if (this._parsed.has(text)) {
            const statementName = this._parsed.get(text)!

            if (this._described.has(statementName)) {
                const columns = this._described.get(statementName)
                return new Query(
                    text, args, 
                    QueryState.Executing, 
                    statementName, 
                    columns
                )
            }
            else {
                if (this._describingPending.has(statementName)) {
                    return new Query(
                        text, args, 
                        QueryState.Executing,
                        statementName
                    )
                }
                else {
                    this._describingPending.add(statementName)

                    return new Query(
                        text, args,
                        QueryState.Describing,
                        statementName
                    )
                }
            }
        }

        else {
            if (this._parsingPending.has(text)) {
                const statementName = this._parsingPending.get(text)!
                return new Query(
                    text, args,
                    QueryState.Describing,
                    statementName
                )
            }
            else {
                const statementName = this._nextStatement()
                this._parsingPending.set(text, statementName)
                return new Query(
                    text, args,
                    QueryState.Parsing,
                    statementName
                )
            }
        }
    }


    private _writeQuery(query: Query<any>) {        
        if (query.state === QueryState.Parsing) {
            this._writer
                .writeParse(query.statementName, query.text)
                .writeDescribe(query.statementName)
                .writeBind("", query.statementName, query.args)
                .writeExecute("")
        }
        if (query.state === QueryState.Describing) {
            this._writer
                .writeDescribe(query.statementName)
                .writeBind("", query.statementName, query.args)
                .writeExecute("")
        }
        if (query.state === QueryState.Executing) {
            this._writer
                .writeBind("", query.statementName, query.args)
                .writeExecute("")
        }

        this._pipelinesQueue.get().push(query)
    }


    private _registerFlush() {
        if (!this._isFlushing) {
            this._isFlushing = true
            this._pipelinesQueue.push(new Queue<Query<any>>())
            nextTick(() => {
                this._flush()                
            })
        }
    }


    private _flush() {      
        if (!this._isOpened) {
            this._rejectPipeline(ErrConnectionClosed)
            return
        }

        if (this._isReconnecting) {
            this._reconnect().then(() => {
                this._isFlushing = false
                this._socket.write(this._writer.writeSync())
                this._writer.clear()
            })
        }

        else {
            this._isFlushing = false
            this._socket.write(this._writer.writeSync())
            this._writer.clear()
        }
    }

    
    private _registerReconnect() {
        this._isReconnecting = true
        this._rejectPipeline(ErrConnectionReconnecring)
    }


    private _resetConnectionState(cause: PostgresError) {
        this._parsed.clear()
        this._described.clear()
        this._describingPending.clear()
        this._parsingPending.clear()
        this._writer.clear()
        
        this._rejectPipeline(cause)
    }


    private async _reconnect() {
        this._resetConnectionState(ErrConnectionReconnecring)

        const socket = await createAuthorizedSocket(ConnectionRequestWriter.new(), this.params)

        const connector = new SocketConnector(
            socket, 
            (type, reader) => this._handlePacket(type, reader),
            (err) => this._registerReconnect()
        )

        this._socket = connector

        void this._restoreSubscriptions()
        
        this._isReconnecting = false
    }

    
    private _restoreSubscriptions() {
        if (this._listeningCallbacks.size === 0) return Promise.resolve()

        const promises = Array.from(this._listeningCallbacks.keys()).map(channel => {
            return this.query`LISTEN ${sql.ident(channel)};`
        })

        return Promise.all(promises)
    }


    private _getCurrentQuery() {
        return this._pipelinesQueue.get().get()
    }


    private _rejectPipeline(error: PostgresError) {
        if (this._pipelinesQueue.isFree) return 

        const queue = this._pipelinesQueue.get()

        while (queue.hasMore) {
            queue.get().reject(error)
            queue.next()
        }
    }


    private _handlePacket(type: ResponseType, reader: ConnectionResponseReader) {
        switch (type) {
            case ResponseTypes.ParseComplete: {
                reader.readParseComplete()
                const query = this._getCurrentQuery()

                this._parsingPending.delete(query.text)
                this._parsed.set(query.text, query.statementName)
                query.state = QueryState.Describing

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

                const query = this._getCurrentQuery()
                this._describingPending.delete(query.statementName)
                this._described.set(query.statementName, [])
                query.state = QueryState.Executing
            } break


            case ResponseTypes.RowDescription: {
                const columns = reader.readRowDescription()

                const query = this._getCurrentQuery()
                this._describingPending.delete(query.statementName)
                this._described.set(query.statementName, columns)
                query.state = QueryState.Executing
                query.columns = columns
            } break


            case ResponseTypes.DataRow: {
                const query = this._getCurrentQuery()

                if (!query.columns) {
                    query.columns = this._described.get(query.statementName)!
                }

                query.rows.push(reader.readDataRow(query.columns, this.params.int8toBigint))
            } break


            case ResponseTypes.ComandComplete: {
                reader.readCommandComplete()

                if (this._pipelinesQueue.isFree) {
                    this.close()
                    break
                }

                const query = this._getCurrentQuery()
                
                if (!query) {
                    this.close()
                    break
                }

                if (!query.columns) {
                    query.columns = this._described.get(query.statementName)!
                }

                query.state = QueryState.Completed
                
                this._pipelinesQueue.get().next()                

                query.resolve(
                    query.toObjects()
                )
            } break


            case ResponseTypes.ErrorResponse: {
                const error = reader.readErrorResponse()

                if (this._logLevel === 'error' || this._logLevel === 'notice' || this._logLevel === 'query') {
                    console.log(`\nError:    ${error}\n`)
                }
                const query = this._getCurrentQuery()

                switch (query.state) {
                    case QueryState.Parsing:
                        this._parsingPending.delete(query.text)
                        break

                    case QueryState.Describing:
                        this._describingPending.delete(query.statementName)
                        break
                }

                query.state = QueryState.Failed

                this._rejectPipeline(error)
            } break


            case ResponseTypes.ReadyForQuery: {
                reader.readReadyForQuery()
                const pipeline = this._pipelinesQueue.get()

                if (!pipeline.hasMore) {
                    this._pipelinesQueue.next()
                }
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
        while (this._pipelinesQueue.hasMore) {
            this._rejectPipeline(ErrConnectionClosed)
            this._pipelinesQueue.next()
        }
    }
}
