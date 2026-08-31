import { Socket } from "net"
import { ConnectionRequestWriter } from "./protocol/connection-request-writer"
import { INT4Length, ResponseType, ResponseTypes } from "./protocol/constants"
import { ConnectionResponseReader } from "./protocol/connection-response-reader"
import { compileSqlTemplate } from "./utils/template-compiler"
import { ChannelName, ConnectionConfig, ConnectionPartialConfig, QueryMeta, QueryText, Resolvers, Row, StatementName } from "./types"
import { Transaction } from "./transaction"
import { SocketConnector } from "./protocol/socket-connector"
import { Queue } from "./queue"
import { CollectQuery, StreamQuery, ExecuteQuery, PostgresQuery } from "./query"
import { sql } from "."
import { Begin, Future, Ok } from 'fluent-future'
import { ErrConnectionClosed, ErrConnectionReconnecting, PostgresError } from "./error"
import { ReadableStreamDefaultController } from "stream/web"
import { nextTick } from "process"
import { authorizeSocket, createSocket, upgradeSocket } from "./protocol/socket-authorization"


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

    private _writer = ConnectionRequestWriter.new()
    private _sheduled = false
    private _queue = new Queue<PostgresQuery>()

    private _closing: Resolvers<Future<void, PostgresError>> | null = null
    private _closed = false
    private _reconnecting: Future<void, PostgresError> | null = null

    private _socket: SocketConnector

    private _parsed: Record<QueryText, QueryMeta> = {}
    private _parsing: Record<QueryText, StatementName> = {}

    private _listeningCallbacks = new Map<ChannelName, Set<(payload: string) => void>>()
    private _stmtCounter = 0

    private _nextStatement() {
        return `s-${this._stmtCounter++}` as StatementName
    }

    private _registerShedule() {
        if (!this._sheduled) {
            this._sheduled = true
            this._writer.clear()
            shedule[this.config.syncShedule](() => this._shedule())
        }
    }

    private _shedule() {
        if (this._reconnecting) return

        this._socket.write(this._writer)
        this._writer.clear()
        this._sheduled = false
    }


    private _parseQuery(query: PostgresQuery) {
        this._registerShedule()

        this._writer
            .writeParse(query.statement, query.text)
            .writeDescribe(query.statement)
    }


    private _registerQuery(query: PostgresQuery) {
        this._registerShedule()

        this._queue.push(query)

        this._writer
            .writeBind("", query.statement, query.args)
            .writeExecute("")
            .writeSync()
    }


    private constructor(
        socket: Socket,
        config: ConnectionConfig,
    ) {
        this.config = config
        this._socket = new SocketConnector(socket, 
            this._handlePacket.bind(this),
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
            syncShedule: config.syncShedule || 'Immediate',
            ssl: config.caPath ? 'require' : (config.ssl || 'prefer')
        }


        return createSocket(conf)
            .andThen(socket => upgradeSocket(socket, conf))
            .andThen(socket => authorizeSocket(socket, conf))
            .andThen(socket => Ok(new Connection(socket, conf)))
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

        const {text, args} = compileSqlTemplate(templates, params)

        const resolvers = Future.withResolvers<T[], PostgresError>()

        if (this._reconnecting) return this._reconnecting.andThen(() => this._performQuery<T>(text, args, resolvers))

        return this._performQuery<T>(text, args, resolvers)
    }


    private _performQuery<T extends Row>(text: QueryText, args: (string | null)[], resolvers: Resolvers<Future<T[], PostgresError>>): Future<T[], PostgresError> {
        if (this.config.logLevel === 'query') { 
            console.log(
                `\n\x1b[36m┌─ QUERY ─────────────────────────────────────────\x1b[0m\n`
                + `\x1b[36m│\x1b[0m ${text}\n` 
                + `${args.length !== 0 ? `\x1b[36m│\x1b[0m \x1b[90mArguments:\x1b[0m [${args}]\n` : ''}` 
                + `\x1b[36m└────────────────────────────────────────────────\x1b[0m` 
            ) 
        }

        const parsed = this._parsed[text]
        if (parsed) {
            const query = new CollectQuery<T>(
                parsed.statement, text, args, parsed.columns, this.config.queryTimeout, resolvers
            )
            this._registerQuery(query)

            return query.resolvers.future
        }

        const parsing = this._parsing[text]
        if (parsing) {
            const query = new CollectQuery<T>(
                parsing, text, args, null, this.config.queryTimeout, resolvers
            )

            this._registerQuery(query)

            return query.resolvers.future
        }

        
        const query = new CollectQuery<T>(
            this._nextStatement(), text, args, null, this.config.queryTimeout, resolvers
        )
        
        this._parsing[text] = query.statement
        this._parseQuery(query)
        this._registerQuery(query)

        return query.resolvers.future
    }


    /**
     * Like {@link query}, but for statements that don't return rows (INSERT/UPDATE/DDL/etc).
     *
     * @example
     * await conn.execute`UPDATE users SET name = ${name} WHERE id = ${id}`
     */
    execute(templates: TemplateStringsArray, ...params: any[]) {
        if (this.isClosed) return Future.reject(ErrConnectionClosed)

        const {text, args} = compileSqlTemplate(templates, params)

        const resolvers = Future.withResolvers<void, PostgresError>()
            
        if (this._reconnecting) return this._reconnecting.andThen(() => this._performExecute(text, args, resolvers))

        return this._performExecute(text, args, resolvers)
    }


    private _performExecute(text: QueryText, args: (string | null)[], resolvers: Resolvers<Future<void, PostgresError>>): Future<void, PostgresError> {
        if (this.config.logLevel === 'query') { 
            console.log( 
                `\n\x1b[35m┌─ EXECUTE ──────────────────────────────────────\x1b[0m\n` 
                + `\x1b[35m│\x1b[0m ${text}\n` 
                + `${args.length !== 0 ? `\x1b[35m│\x1b[0m \x1b[90mArguments:\x1b[0m [${args}]\n` : ''}` 
                + `\x1b[35m└────────────────────────────────────────────────\x1b[0m` 
            ) 
        }

        const parsed = this._parsed[text]
        if (parsed) {           
            const query = new ExecuteQuery(
                parsed.statement, text, args, this.config.queryTimeout, resolvers
            )
            this._registerQuery(query)
            
            return query.resolvers.future
        }

        const parsing = this._parsing[text]
        if (parsing) {
            const query = new ExecuteQuery(
                parsing, text, args, this.config.queryTimeout, resolvers
            )

            this._registerQuery(query)

            return query.resolvers.future
        }

        const query = new ExecuteQuery(
            this._nextStatement(), text, args, this.config.queryTimeout, resolvers
        )

        this._parsing[text] = query.statement
        this._parseQuery(query)
        this._registerQuery(query)

        return query.resolvers.future
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

        const {text, args} = compileSqlTemplate(templates, params)
        
        let controller!: ReadableStreamDefaultController<T>

        const stream = new ReadableStream<T>({
            start: c => {
                controller = c
            }
        })

        if (this._reconnecting) {
            this._reconnecting
                .tap(() => this._performStream<T>(text, args, controller))
                .tapErr(err => controller.error(err))

            return stream
        }

        this._performStream<T>(text, args, controller)

        return stream
    }
    

    private _performStream<T extends Row>(text: QueryText, args: (string | null)[], controller: ReadableStreamDefaultController<T>) {
        if (this.config.logLevel === 'query') { 
            console.log( 
                `\n\x1b[34m┌─ STREAM ───────────────────────────────────────\x1b[0m\n` 
                + `\x1b[34m│\x1b[0m ${text}\n` 
                + `${args.length !== 0 ? `\x1b[34m│\x1b[0m \x1b[90mArguments:\x1b[0m [${args}]\n` : ''}` 
                + `\x1b[34m└────────────────────────────────────────────────\x1b[0m` 
            ) 
        }

        const parsed = this._parsed[text]
        if (parsed) {
            const query = new StreamQuery<T>(
                parsed.statement, text, args, 
                controller, parsed.columns, 
                this.config.queryTimeout
            )
            this._registerQuery(query)

            return
        }

        const parsing = this._parsing[text]
        if (parsing) {
            const query = new StreamQuery(
                parsing, text, args, controller, 
                null, this.config.queryTimeout
            )

            this._registerQuery(query)

            return
        }
        
        const query = new StreamQuery<T>(
            this._nextStatement(), 
            text, args, controller, 
            null, this.config.queryTimeout
        )

        this._parsing[text] = query.statement
        this._parseQuery(query)
        this._registerQuery(query)
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
        this._parsed = {}
        this._parsing = {}
        this._sheduled = false

        while (this._queue.hasMore) {
            this._queue.shift.error(ErrConnectionReconnecting)
        }
        this._writer.clear()

        
        return createSocket(this.config)
            .andThen(socket => upgradeSocket(socket, this.config))
            .andThen(socket => authorizeSocket(socket, this.config))
            .andThen(socket => {
                const connector = new SocketConnector(
                    socket, 
                    this._handlePacket.bind(this),
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


    private get _currentQuery() {        
        return this._queue.current
    }


    private _handlePacket(type: ResponseType, length: number, reader: ConnectionResponseReader) {
        switch (type) {
            case ResponseTypes.ParseComplete: {
                reader.readParseComplete()
            } break


            case ResponseTypes.BindComplete: {
                reader.readBindComplete()

                const query = this._currentQuery

                if (query instanceof ExecuteQuery) {
                    break
                }

                if (!query.columns) {
                    query.columns = this._parsed[query.text].columns
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
                
                const query = this._currentQuery
                
                const meta = {statement: query.statement, columns: []}
                
                
                delete this._parsing[query.text] 

                this._parsed[query.text] = meta
            } break


            case ResponseTypes.RowDescription: {
                const columns = reader.readRowDescription()

                const query = this._currentQuery
                
                const meta = {
                    statement: query.statement, columns
                }
                
                delete this._parsing[query.text]

                this._parsed[query.text] = meta
            } break



            case ResponseTypes.DataRow: {
                let query = this._currentQuery

                if (query instanceof ExecuteQuery) {
                    reader.skip(length - INT4Length)
                    break
                }

                query.push(reader.readDataRow(query.columns!, this.config.int8toBigint))
            } break


            case ResponseTypes.ComandComplete: {
                reader.readCommandComplete()

                const query = this._currentQuery
                
                query.complete()
            } break


            case ResponseTypes.ErrorResponse: {
                const error = reader.readErrorResponse()

                if (this.config.logLevel === 'error' || this.config.logLevel === 'notice' || this.config.logLevel === 'query') { 
                    console.log( 
                        `\n\x1b[31m┌─ ERROR ────────────────────────────────────────\x1b[0m\n` 
                        + `\x1b[31m│\x1b[0m ${error}\n` 
                        + `\x1b[31m└────────────────────────────────────────────────\x1b[0m\n` 
                    ) 
                }

                const query = this._currentQuery

                if (error.isParseError) {
                    delete this._parsing[query.text]
                }

                query.error(error)
            } break


            case ResponseTypes.ReadyForQuery: {
                reader.readReadyForQuery()
                
                this._queue.next()

                this._closing && this._queue.isFree && this._closing.resolve()    
            } break


            case ResponseTypes.Notice: {
                const message = reader.readErrorResponse()
                
                if (this.config.logLevel === 'notice' || this.config.logLevel === 'query') { 
                    console.log( 
                        `\n\x1b[33m┌─ NOTICE ───────────────────────────────────────\x1b[0m\n` 
                        + `\x1b[33m│\x1b[0m ${message}\n` 
                        + `\x1b[33m└────────────────────────────────────────────────\x1b[0m\n` 
                    ) 
                }
            } break


            case ResponseTypes.NotificationResponse: {
                const {name, payload} = reader.readNotificationResponse()

                const callbackSet = this._listeningCallbacks.get(name)

                if (!callbackSet) break

                callbackSet.forEach(cb => cb(payload))
            } break


            default: {
                reader.skip(length - INT4Length)
            } break
        }
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

        if (this._queue.isFree) {
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
