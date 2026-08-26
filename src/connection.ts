import { Socket } from "net"
import { ConnectionRequestWriter } from "./protocol/connection-request-writer"
import { createAuthorizedSocket } from "./protocol/socket-authorization"
import { ResponseType, ResponseTypes } from "./protocol/constants"
import { ConnectionResponseReader } from "./protocol/connection-response-reader"
import { compileSqlTemplate } from "./utils/template-compiler"
import { ChannelName, ConnectionConfig, ConnectionPartialConfig, QueryMeta, QueryText, Resolvers, Row, StatementName } from "./types"
import { Transaction } from "./transaction"
import { SocketConnector } from "./protocol/socket-connector"
import { Queue } from "./queue"
import { CollectQuery, StreamQuery, ExecuteQuery } from "./query"
import { sql } from "."
import { Begin, Future, Ok } from 'fluent-future'
import { ErrConnectionClosed, ErrConnectionReconnecting, PostgresError } from "./error"
import { ReadableStreamDefaultController } from "stream/web"
import { Batch } from "./batch"
import { nextTick } from "process"


const shedule = {
    Immediate: setImmediate,
    afterMicrotask: setTimeout,
    beforeMicrotask: nextTick
}


/**
 * A dedicated connection to PostgreSQL: tagged-template queries, prepared
 * statement caching, transactions with savepoints, and pipelined execution.
 *
 * @example
 * const conn = await Connection.new({ host: 'localhost', user: 'postgres', password: 'postgres', database: 'test' })
 * const users = await conn.query`SELECT * FROM users WHERE id = ${1}`
 * await conn.begin(async tx => tx.query`INSERT INTO users ...`)
 * conn.close()
 */
export class Connection {
    private readonly config: ConnectionConfig

    private _activeBatch: Batch | null = null
    private _closing: Resolvers<Future<void, PostgresError>> | null = null
    private _closed = false
    private _reconnecting: Future<void, PostgresError> | null = null
    private _cachedBuffer = ConnectionRequestWriter.new()

    private _socket: SocketConnector
    private _batchQueue: Queue<Batch> = new Queue()

    private _parsed = new Map<QueryText, QueryMeta>()
    private _parsing = new Map<QueryText, StatementName>()

    private _listeningCallbacks = new Map<ChannelName, Set<(payload: string) => void>>()
    private _stmtCounter = 0


    private _nextStatement() {
        return `s-${this._stmtCounter++}` as StatementName
    }


    private constructor(
        config: ConnectionConfig,
        socket: Socket,
    ) {
        this.config = config
        this._socket = new SocketConnector(socket, 
            (type, length, reader) => this._handlePacket(type, reader, length),
            () => this._reconnect()
        )
    }


    /**
     * Opens a new connection and authenticates.
     * @throws {PostgresError} if authentication fails or the connection can't be established
     */
    static new(config: ConnectionPartialConfig) {
        const conf: ConnectionConfig = {
            ...config,
            logLevel: config.logLevel || 'error',
            int8toBigint: config.int8toBigint || false,
            queryTimeout: config.queryTimeout || 30000,
            syncShedule: config.syncShedule || 'afterMicrotask'
        }

        const writer = ConnectionRequestWriter.new()
        return createAuthorizedSocket(writer, conf)
            .andThen(socket => Ok(new Connection(conf, socket)))
    }


    private _registerBatch() {
        if (!this._activeBatch) {
            const batch = new Batch(this._cachedBuffer.clear())
            this._activeBatch = batch;

            shedule[this.config.syncShedule](() => this._sync(batch))

            return batch
        }

        return this._activeBatch
    }


    private _sync(batch: Batch) {
        if (this._reconnecting) return

        this._socket.write(batch.end())
        this._activeBatch = null
        this._batchQueue.push(batch)
    }


    /**
     * Runs a query, binding template values as `$1, $2, ...`.
     * Parameterized queries are cached as prepared statements.
     *
     * @example
     * const users = await conn.query<User>`SELECT * FROM users WHERE id = ${1}`
     */
    query<T extends Row>(templates: TemplateStringsArray, ...params: any[]) {
        if (this.isClosed) return Future.reject(ErrConnectionClosed)
            
        if (this._reconnecting) return this._reconnecting.andThen(() => this._performQuery<T>(templates, ...params))

        return this._performQuery<T>(templates, ...params)
    }


    private _performQuery<T extends Row>(templates: TemplateStringsArray, ...params: any[]): Future<T[], PostgresError> {
        
        const {text, args} = compileSqlTemplate(templates, params) as {text: QueryText, args: (string | null)[]}
        
        if (this.config.logLevel === 'query') {
            console.log(`\nQUERY:     ${text}\n${args.length !== 0 ? `ARGUMENTS: [${args}]\n` : ""}`)
        }

        if (this._parsed.has(text)) {
            const meta = this._parsed.get(text)!
            
            const query = new CollectQuery<T>(
                meta.statement, text, args, meta.columns, this.config.queryTimeout
            )
            this._registerBatch().registerQuery(query)

            return query.future
        }

        if (this._parsing.has(text)) {
            const statement = this._parsing.get(text)!

            const query = new CollectQuery<T>(
                statement, text, args, null, this.config.queryTimeout
            )

            this._registerBatch().registerQuery(query)

            return query.future
        }

        
        const query = new CollectQuery<T>(
            this._nextStatement(), text, args, null, this.config.queryTimeout
        )

        this._parsing.set(text, query.statement)
        this._registerBatch().registerParse(query)
        this._registerBatch().registerQuery(query)

        return query.future
    }


    /**
     * Like {@link query}, but for statements that don't return rows (INSERT/UPDATE/DDL/etc).
     *
     * @example
     * await conn.execute`UPDATE users SET name = ${name} WHERE id = ${id}`
     */
    execute(templates: TemplateStringsArray, ...params: any[]) {
        if (this.isClosed) return Future.reject(ErrConnectionClosed)
            
        if (this._reconnecting) return this._reconnecting.andThen(() => this._performExecute(templates, ...params))

        return this._performExecute(templates, ...params)
    }


    private _performExecute(templates: TemplateStringsArray, ...params: any[]): Future<void, PostgresError> {

        const {text, args} = compileSqlTemplate(templates, params) as {text: QueryText, args: (string | null)[]}
        
        if (this.config.logLevel === 'query') {
            console.log(`\nQUERY:     ${text}\n${args.length !== 0 ? `ARGUMENTS: [${args}]\n` : ""}`)
        }

        if (this._parsed.has(text)) {
            const meta = this._parsed.get(text)!
            
            const query = new ExecuteQuery(
                meta.statement, text, args, this.config.queryTimeout
            )
            this._registerBatch().registerQuery(query)
            
            return query.future
        }

        if (this._parsing.has(text)) {
            const statement = this._parsing.get(text)!
            const query = new ExecuteQuery(statement, text, args, this.config.queryTimeout)

            this._registerBatch().registerQuery(query)

            return query.future
        }

        const query = new ExecuteQuery(this._nextStatement(), text, args, this.config.queryTimeout)

        this._parsing.set(text, query.statement)
        this._registerBatch().registerParse(query)
        this._registerBatch().registerQuery(query)

        return query.future
    }


    /**
     * Runs `txCallback` inside `BEGIN`/`COMMIT`, rolling back on error.
     *
     * @example
     * await conn.begin(async tx => {
     *   await tx.query`UPDATE accounts SET balance = balance - 10 WHERE id = 1`
     * })
     */
    begin<T>(txCallback: (transaction: Transaction) => Promise<T>) {
        if (this.isClosed) return Future.reject(ErrConnectionClosed)


        return Begin()
            .andThen(() => this.execute`begin`)    
            .andThen(() =>  {
                const tx = new Transaction(this)

                return Future.of(txCallback(tx))
                    .tap(() => {
                        if (tx.isActive) return tx.commit()
                    })
                    .tapErr(() => {
                        if (tx.isActive) return tx.rollback()
                    })
            })
    }


    /** Sends a `pg_notify` message on `channelName` (payload ≤ 8000 bytes). */
    notify(channelName: string, payload: string = "") {
        if (this.isClosed) return Future.reject(ErrConnectionClosed)

        return this.execute`select pg_notify(${channelName}, ${payload})`.map(() => {})
    }


    /** Subscribes `callback` to `channelName`, issuing `LISTEN` on first subscription. */
    listen(channelName: string, callback: (payload: string) => void) {
        if (this.isClosed) return Future.reject(ErrConnectionClosed)

        if (!this._listeningCallbacks.has(channelName as ChannelName)) {
            this._listeningCallbacks.set(channelName as ChannelName, new Set())
        }

        const callbackSet = this._listeningCallbacks.get(channelName as ChannelName)!

        callbackSet.add(callback)

        return this.execute`listen ${sql.ident(channelName)};`
    }


    /** Unsubscribes `callback`, issuing `UNLISTEN` once no callbacks remain. */
    unlisten(channelName: string, callback: (payload: string) => void): Future<void, PostgresError> {
        if (this.isClosed) return Future.reject(ErrConnectionClosed)

        if (!this._listeningCallbacks.has(channelName as ChannelName)) {
            return Ok()
        }

        const callbackSet = this._listeningCallbacks.get(channelName as ChannelName)!

        callbackSet.delete(callback)

        if (callbackSet.size === 0) {
            this._listeningCallbacks.delete(channelName as ChannelName)
            return this.execute`unlisten ${sql.ident(channelName)};`.map(() => {})
        }
        
        return Ok()
    }


    /**
     * Streams query results as a `ReadableStream`, without buffering rows in memory.
     * Ideal for large result sets or piping straight into an HTTP response.
     *
     * @example
     * for await (const row of conn.stream<User>`SELECT * FROM orders`) { ... }
     */
    stream<T extends Row>(templates: TemplateStringsArray, ...params: any[]) {
        if (this.isClosed) throw ErrConnectionClosed
        
        let controller!: ReadableStreamDefaultController<T>

        const stream = new ReadableStream<T>({
            start: c => {
                controller = c
            }
        })

        if (this._reconnecting) {
            this._reconnecting
                .tap(() => this._performStream<T>(templates, params, controller))
                .tapErr(err => controller.error(err))

            return stream
        }

        this._performStream<T>(templates, params, controller)

        return stream
    }
    

    private _performStream<T extends Row>(templates: TemplateStringsArray, params: any[], controller: ReadableStreamDefaultController<T>) {
        const {text, args} = compileSqlTemplate(templates, params) as {text: QueryText, args: (string | null)[]}
        
        if (this.config.logLevel === 'query') {
            console.log(`\nQUERY:     ${text}\n${args.length !== 0 ? `ARGUMENTS: [${args}]\n` : ""}`)
        }


        if (this._parsed.has(text)) {
            const meta = this._parsed.get(text)!

            const query = new StreamQuery<T>(
                meta.statement, text, args, 
                controller, meta.columns, 
                this.config.queryTimeout
            )
            this._registerBatch().registerQuery(query)

            return
        }

        if (this._parsing.has(text)) {
            const statement = this._parsing.get(text)!

            const query = new StreamQuery(statement, text, args, controller, null, this.config.queryTimeout)

            this._registerBatch().registerQuery(query)

            return
        }
        
        const query = new StreamQuery<T>(
            this._nextStatement(), 
            text, args, controller, 
            null, this.config.queryTimeout
        )

        this._parsing.set(text, query.statement)
        this._registerBatch().registerParse(query)
        this._registerBatch().registerQuery(query)
    }
    

    private _reconnect() {
        if (this.isClosed) return
        if (this._reconnecting) return

        this._reconnecting = this._performReconnect()
            .tap(() => this._reconnecting = null)
            .andThen(() => this._restoreSubscriptions())
            .tapErr(() => {
                this._reconnecting = null
                this._reconnect()
            })
            .recover()
    }


    private _performReconnect() {
        this._socket.destroy()
        this._parsed.clear()
        this._parsing.clear()
        this._activeBatch?.reject(ErrConnectionReconnecting)
        this._activeBatch = null
        
        while (this._batchQueue.hasMore) {            
            this._batchQueue.shift.reject(ErrConnectionReconnecting)
        }


        return createAuthorizedSocket(ConnectionRequestWriter.new(), this.config)
            .andThen(socket => {
                const connector = new SocketConnector(
                    socket, 
                    (type, length ,reader) => this._handlePacket(type, reader, length),
                    () => this._reconnect()
                )

                this._socket = connector

                return Ok()
            })
    }

    
    private _restoreSubscriptions() {
        if (this._listeningCallbacks.size === 0) return Future.resolve()

        const futures = Array.from(this._listeningCallbacks.keys()).map(channel => {
            return this.execute`LISTEN ${sql.ident(channel)};`
        })

        return Future.all(futures).map(() => {})
    }


    private _getCurrentQuery() {        
        return this._batchQueue.current.current
    }


    private _handlePacket(type: ResponseType, reader: ConnectionResponseReader, length: number) {
        switch (type) {
            case ResponseTypes.ParseComplete: {
                reader.readParseComplete()
            } break


            case ResponseTypes.BindComplete: {
                reader.readBindComplete()

                const query = this._getCurrentQuery()

                if (query instanceof ExecuteQuery) {
                    break
                }

                if (!query.columns) {
                    query.columns = this._parsed.get(query.text)!.columns
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
                
                const meta = {statement: query.statement, columns: []}
                
                this._parsing.delete(query.text)

                this._parsed.set(query.text, meta)
            } break


            case ResponseTypes.RowDescription: {
                const columns = reader.readRowDescription()

                const query = this._getCurrentQuery()
                
                const meta = {
                    statement: query.statement, columns
                }
                
                this._parsing.delete(query.text)

                this._parsed.set(query.text, meta)
            } break



            case ResponseTypes.DataRow: {
                let query = this._getCurrentQuery()

                if (query instanceof ExecuteQuery) {
                    reader.skip(length - 4)
                    break
                }

                query.push(reader.readDataRow(query.columns!, this.config.int8toBigint))
            } break


            case ResponseTypes.ComandComplete: {
                reader.readCommandComplete()

                const query = this._getCurrentQuery()
                
                query.resolve()
                
                this._batchQueue.current.next()
            } break


            case ResponseTypes.ErrorResponse: {
                const error = reader.readErrorResponse()

                if (this.config.logLevel === 'error' || this.config.logLevel === 'notice' || this.config.logLevel === 'query') {
                    console.log(`\nError:    ${error}\n`)
                }

                this._parsing.clear()

                this._batchQueue.current.reject(error)
            } break


            case ResponseTypes.ReadyForQuery: {
                reader.readReadyForQuery()
                
                this._batchQueue.next()
                
                this._closing && !this._hasQueries && this._closing.resolve()
                
            } break


            case ResponseTypes.Notice: {
                const message = reader.readErrorResponse()
                
                if (this.config.logLevel === 'notice' || this.config.logLevel === 'query') {
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


    private get _hasQueries() {
        return this._batchQueue.hasMore || this._activeBatch
    }


    /** Whether the connection is alive and usable. */
    get isOpened() {
        return !this._closing && !this._closed
    }


    /** Whether the connection is closed or closing. */
    get isClosed() {
        return this._closed || !!this._closing
    }


    /**
     * Closes the connection, awaiting for all pending queries. Not usable afterward.
     */
    close() {
        if (this._closed) return Future.resolve()

        if (this._closing) {
            return this._closing.future
        }        

        if (!this._hasQueries) {
            this._closed = true
            this._socket.destroy()
            return Future.resolve()
        }

        const closing = Future.withResolvers<void, PostgresError>()
        this._closing = closing

        closing.future.tap(() => {
            this._closing = null
            this._closed = true
            this._socket.destroy()
        })

        return closing.future
    }
}
