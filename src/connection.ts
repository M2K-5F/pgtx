import { Socket } from "net"
import { nextTick } from "process"
import { ConnectionRequestWriter } from "./protocol/connection-request-writer"
import { createAuthorizedSocket } from "./protocol/socket-authorization"
import { ResponseType, ResponseTypes, TransactionStatuses } from "./protocol/constants"
import { ConnectionResponseReader } from "./protocol/connection-response-reader"
import { parseRowValues } from "./utils/value-parser"
import { compileSqlTemplate } from "./utils/template-compiler"
import { Branded, ColumnDescription } from "./types"
import { Transaction } from "./transaction"
import { SocketConnector } from "./protocol/socket-connector"
import { Queue } from "./queue"
import { Query, QueryState } from "./query"
import { QuicSession } from "node:quic"

type LogLevel = "none" | "error" | "notice" | "query"

export type ConnectionParams = {
    user: string
    password?: string
    host: string
    port: number
    database: string
    logLevel?: LogLevel
}

const ErrConnectionDead = new Error("Connection is Dead")


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

export type StatementName = Branded<string, 'statementName'>

export type QueryText = Branded<string, 'queryText'>


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
    private _isFlushing = false
    private _isAlive = true
    private _socket: SocketConnector
    private _writer: ConnectionRequestWriter

    private _pipelinesQueue = new Queue<Pipeline>()

    private _described = new Map<StatementName, ColumnDescription[]>()
    private _describingPending = new Set<StatementName>()
    private _parsed = new Map<QueryText, StatementName>()
    private _parsingPending = new Map<QueryText, StatementName>()

    private _stmtCounter = 0
    private _logLevel: LogLevel


    private _nextStatement() {
        return `s-${this._stmtCounter++}` as StatementName
    }

    private constructor(
        socket: Socket,
        writer: ConnectionRequestWriter,
        logLevel: LogLevel
    ) {
        this._logLevel = logLevel
        this._socket = new SocketConnector(socket, 
            (type, reader) => this._handlePacket(type, reader),
            (err) => {
                this._destroyConnection()
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
    static async new(params: ConnectionParams) {
        const writer = ConnectionRequestWriter.new()
        const socket = await createAuthorizedSocket(writer, params)
        
        return new Connection(socket, writer, params.logLevel || 'error')
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
    query<T extends Record<string, any>>(templates: TemplateStringsArray, ...params: any[]): Promise<T[]> {
        this._registerFlush()
        if (!this._isAlive) throw ErrConnectionDead

        const {text, args} = compileSqlTemplate({templates, args: params}) as {text: QueryText, args: (string | null)[]}
        
        if (this._logLevel === 'query') {
            console.log(`\nQUERY:     ${text}\n${args.length !== 0 ? `ARGUMENTS: [${args}]\n` : ""}`)
        }

        const query = this._createQuery<T>(text, args)

        this._writeQuery(query)

        return query.promise
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
    async begin<T>(txCallback: (transaction: Transaction) => Promise<T>): Promise<T> {
        if (!this._isAlive) throw ErrConnectionDead

        const tx = new Transaction(this)
        
        try {
            await tx.query`BEGIN`

            const result = await txCallback(tx)

            if (tx.isActive) await tx.commit()

            return result
        } 
        catch (err) {
            if (tx.isActive) await tx.rollback()
            throw err
        }
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
        this._isFlushing = false
        if (!this._isAlive) {
            this._rejectPipeline(ErrConnectionDead)
            return
        }
        try {
            this._socket.write(this._writer.writeSync())
            this._writer.clear()
        }
        catch (err) {
            this._destroyConnection()
        }
    }


    private _getCurrentQuery() {
        return this._pipelinesQueue.get().get()
    }


    private _rejectPipeline(error: Error) {
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

                query.rows.push(reader.readDataRow())
            } break


            case ResponseTypes.ComandComplete: {
                reader.readCommandComplete()

                if (this._pipelinesQueue.isFree) {
                    this._destroyConnection()
                    break
                }

                const query = this._getCurrentQuery()
                
                if (!query) {
                    this._destroyConnection()
                    break
                }

                if (!query.columns) {
                    query.columns = this._described.get(query.statementName)!
                }

                query.state = QueryState.Completed
                
                this._pipelinesQueue.get().next()                

                query.resolve(
                    parseRowValues(query.columns, query.rows)
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


            default: console.warn('Undeclared response type: ', type);
        }
    }


    /**
     * Checks if the connection is still alive and usable.
     * Returns `false` if the socket is destroyed or connection is dead.
     */
    get isAlive() {
        return this._isAlive && !this._socket.isDestroyed
    }



    private _destroyConnection() {
        this._isAlive = false
        this._socket.destroy()
        this._rejectPipeline(ErrConnectionDead)
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
        this._destroyConnection()
    }
}
