import { Socket } from "net"
import { nextTick } from "process"
import { ConnectionRequestWriter } from "./protocol/connection-request-writer"
import { createAuthorizedSocket } from "./protocol/socket-authorization"
import { ResponseType, ResponseTypes, TransactionStatuses } from "./protocol/constants"
import { ConnectionResponseReader } from "./protocol/connection-response-reader"
import { parseRowValues } from "./utils/value-parser"
import { compileSqlTemplate } from "./utils/template-compiler"
import { ColumnDescription } from "./types"
import { Transaction } from "./transaction"
import { SocketConnector } from "./protocol/socket-connector"
import { Queue } from "./queue"

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


export type ConnectionQueryContext = {
    columns: ColumnDescription[]
    rows: (string | null)[][]
    resolve: (value: any) => void
    reject: (err: Error) => void
    statementName: string | null
}


export class ConnectionQueryQueue extends Queue<ConnectionQueryContext> {

    rejectAllNext(error: Error) {
        while (!this.isFree) {
            this.get().reject(error)
            this.next()
        }
    }
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
    private _isFlushing = false
    private _isAlive = true
    private _socket: SocketConnector
    private _writer: ConnectionRequestWriter
    private _queue = new ConnectionQueryQueue()
    private _statementDescriptions = new Map<string, ColumnDescription[]>()
    private _statements = new Map<string, string>()
    private _stmtCounter = 0
    private _logLevel: LogLevel


    private _nextStatement() {
        return `s-${this._stmtCounter++}`
    }

    private constructor(
        socket: Socket,
        writer: ConnectionRequestWriter,
        logLevel: LogLevel
    ) {
        this._logLevel = logLevel
        this._socket = new SocketConnector(socket, 
            (type, reader) => this._handlePacket(type, reader),
            error => this._handleError(error)
        )
        this._writer = writer
    }


    /**
     * Creates a new database connection.
     * 
     * @param params - Connection parameters
     * @returns A new Connection instance
     * @throws {Error} If authentication fails or connection cannot be established
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
    query<T extends Record<string, unknown>>(templates: TemplateStringsArray, ...args: any[]): Promise<T[]> {        
        if (!this._isAlive) throw ErrConnectionDead

        const query = compileSqlTemplate({templates, args})
        
        if (this._logLevel === 'query') {
            console.log(`\nQUERY:     ${query.text}\n${query.args.length !== 0 ? `ARGUMENTS: [${query.args}]\n` : ""}`)
        }

        return new Promise<T[]>((resolve, reject) => {
            this._registerFlush()

            if (query.args.length === 0) {
                this._writer.writeQuery(query.text)
                this._queue.push({
                    resolve, reject, columns: [], rows: [], statementName: null
                })
            } 

            else {
                if (!this._statements.has(query.text)) {
                    const newStatement = this._nextStatement()
                    this._statements.set(query.text, newStatement)
                    
                    this._parseStatement(newStatement, query.text)
                }

                const statementName = this._statements.get(query.text)!

                this._queue.push({
                    resolve, reject, columns: [], rows: [], statementName: statementName
                })
                this._writer
                    .writeBind("", statementName, query.args)
                    .writeExecute("")
            }
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


    private _parseStatement(statementName: string, text: string) {
        this._writer
            .writeParse(statementName, text)
            .writeDescribe(statementName)
    }


    private _registerFlush() {
        if (!this._isFlushing) {
            this._isFlushing = true
            nextTick(() => this._flush())
        }
    }


    private _flush() {      
        if (!this._isAlive) {
            this._queue.rejectAllNext(ErrConnectionDead)
            return
        }
        try {
            this._socket.write(this._writer.writeSync())
            this._writer.clear()
        }
        catch (err) {
            this._isAlive = false
            
            this._socket.destroy()
            this._queue.rejectAllNext(ErrConnectionDead)
        }
    }


    private _handlePacket(type: ResponseType, reader: ConnectionResponseReader) {
        const context = this._queue.get()        
        
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
                if (context.statementName) {
                    this._statementDescriptions.set(context.statementName, [])
                }
            } break

            case ResponseTypes.RowDescription: {
                if (context.statementName) {
                    this._statementDescriptions.set(context.statementName, reader.readRowDescription())
                }
                else {
                    context.columns = reader.readRowDescription()
                }
            } break

            case ResponseTypes.DataRow: {
                context.rows.push(reader.readDataRow())
            } break

            case ResponseTypes.ComandComplete: {
                reader.readCommandComplete()

                if (context.statementName) {
                    context.columns = this._statementDescriptions.get(context.statementName)!
                }

                context.resolve(
                    parseRowValues(context.columns, context.rows)
                )

                this._queue.next()
            } break

            case ResponseTypes.ErrorResponse: {
                const message = reader.readErrorResponse()

                if (this._logLevel === 'error' || this._logLevel === 'notice' || this._logLevel === 'query') {
                    console.log(`\nError:    ${message}\n`)
                }
                const error = new Error(message)
                this._queue.rejectAllNext(error)
            } break

            case ResponseTypes.ReadyForQuery: {
                this._isFlushing = false
                reader.readReadyForQuery()
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


    private _handleError(error: Error) {
        this._isAlive = false 
        
        this._queue.rejectAllNext(error)
        this._socket.destroy()
    }


    /**
     * Checks if the connection is still alive and usable.
     * Returns `false` if the socket is destroyed or connection is dead.
     */
    get isAlive() {
        return this._isAlive && !this._socket.isDestroyed
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
        this._isAlive = false
        this._socket.destroy()
    }
}
