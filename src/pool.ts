import { Connection, ConnectionParams } from "./connection"
import { Transaction } from "./transaction"
import { Queue } from "./queue";
import { log } from "console";
import { Future, Resolve } from "fluent-future";
import { PostgresError } from "./error";


type PoolParams = ConnectionParams & {
    max?: number
}


type Waiter = {
    resolve: (conn: Connection) => void
    reject: (err: Error) => void
}

/**
 * The main entry point for Pgtx. 
 * Manages a connection pool and provides high-level API for queries and transactions.
 * 
 * @example
 * ```ts
 * const pool = new Pool({
 *   host: 'localhost',
 *   user: 'postgres',
 *   password: 'postgres',
 *   database: 'test',
 *   max: 10
 * })
 * 
 * // Simple query
 * const users = await pool.query`SELECT * FROM users WHERE id = ${1}`
 * 
 * // Transaction
 * const result = await pool.begin(async tx => {
 *   await tx.query`INSERT INTO users ...`
 *   return 'success'
 * })
 * 
 * // Manual acquire/release
 * const conn = await pool.acquire()
 * try {
 *   await conn.query`SELECT 1`
 * } finally {
 *   pool.release(conn)
 * }
 * 
 * // Clean up
 *  pool.close()
 * ```
 */
export class Pool {
    private _available = new Queue<Connection>()
    private _config: ConnectionParams
    private _max: number
    private _total = 0
    private _waiting = new Queue<Waiter>()
    private _isClosed = false

    private _checkClosed() {
        if (this._isClosed) throw new Error('Pool closed')
    }

    constructor(params: PoolParams) {
        this._config = params
        this._max = params.max || 20
    }


    /**
     * Acquires a dedicated connection from the pool.
     * 
     * **Note:** You must call `pool.release(conn)` manually when finished.
     * For most cases, prefer using `pool.query()` or `pool.begin()` which handle this automatically.
     * 
     * @returns A connection from the pool or a new one if available.
     * 
     * @example
     * ```ts
     * const conn = await pool.acquire()
     * try {
     *   await conn.query`SELECT 1`
     * } finally {
     *   pool.release(conn)
     * }
     * ```
     */
    acquire() {       
        this._checkClosed()

        while (this._available.hasMore) {
            const conn = this._available.get()
            this._available.next()

            if (conn.isOpened) {
                return Resolve(conn)
            }
            this._total--
        }

        if (this._total < this._max) {
            this._total++
            return Future.of(Connection.new(this._config))
                .tapErr(() => this._total--)
            
        }

        return Future.of(new Promise<Connection>((resolve, reject) => {
            this._waiting.push({ resolve, reject })
        }))
    }


    /**
     * Releases the connection back to the pool.
     * 
     * If there are pending `acquire()` calls, the connection is passed directly to the next waiter.
     * Otherwise, it's added to the available connections queue.
     * 
     * @param conn - The connection to release.
     * 
     * @example
     * ```ts
     * const conn = await pool.acquire()
     * try {
     *   await conn.query`SELECT 1`
     * } finally {
     *   pool.release(conn)
     * }
     * ```
     */
    release(conn: Connection) {
        this._checkClosed()

        if (!conn.isOpened) {
            this._total--
            return
        }

        if (this._waiting.hasMore) {
            const waiter = this._waiting.get()
            this._waiting.next()

            waiter.resolve(conn)
            return
        }

        this._available.push(conn)
    }


    /**
     * Starts a managed transaction.
     * 
     * Automatically acquires a connection and handles `BEGIN`, `COMMIT`, and `ROLLBACK`.
     * If the callback throws an error, the transaction is rolled back.
     * 
     * @param txCallback - Async function that receives a `Transaction` instance.
     * @returns The value returned from the callback.
     * 
     * @example
     * ```ts
     * const result = await pool.begin(async tx => {
     *   await tx.query`INSERT INTO accounts (id, balance) VALUES (1, 100)`
     *   await tx.query`UPDATE accounts SET balance = balance - 10 WHERE id = 1`
     *   return { success: true }
     * })
     * ```
     */
    begin<T>(txCallback: (transaction: Transaction) => Promise<T>) {
        this._checkClosed()

        return this.acquire()
            .andThen(conn => 
                conn.begin(txCallback)
                    .finally(() => this.release(conn))
            )
    }


    /**
     * Executes a one-off query using pipeline.
     * 
     * Automatically acquires and releases a connection from the pool.
     * For optimal performance, multiple queries can be pipelined through the same connection.
     * 
     * @param templates - Tagged template string with SQL.
     * @param args - Query parameters.
     * @returns Array of rows with proper typing.
     * 
     * @example
     * ```ts
     * // Simple query
     * const users = await pool.query`SELECT * FROM users`
     * 
     * // With parameters
     * const user = await pool.query`SELECT * FROM users WHERE id = ${1}`
     * 
     * // With typed result
     * type User = { id: number, name: string }
     * const users = await pool.query<User>`SELECT * FROM users`
     * ```
     */
    query<T extends Record<string, any>>(templates: TemplateStringsArray, ...args: any[]) {  
        this._checkClosed()

        while (this._available.hasMore) {
            
            const conn = this._available.get()
            if (conn.isOpened) {
                return conn.query<T>(templates, ...args)
            }
            
            this._available.next()
            this._total--
        }
        
        if (this._total < this._max) {
            this._total++
            return Future.of(Connection.new(this._config))
                .tapErr(() => this._total--)
                .andThen(conn => {
                    this.release(conn)
                    return conn.query<T>(templates, ...args)
                })
        }

        return this.acquire()
            .andThen(conn => {
                this.release(conn) 
                return conn.query<T>(templates, ...args)
            })
    }


    /**
     * Sends an asynchronous notification to a channel via `pg_notify`.
     * 
     * @param channelName - The channel identifier
     * @param payload - Optional string data (max 8000 bytes)
     * 
     * @example
     * ```ts
     * await pool.notify('events', 'hello')
     * ```
     */
    notify(channelName: string, payload: string = "") {
        return this.query`select pg_notify(${channelName}, ${payload})` as Future<[], PostgresError>
    }


    /**
     * Number of available (idle) connections in the pool.
     */
    get size() {
        return this._available.size
    }


    /**
     * Total number of connections currently managed by the pool
     * (available + in use).
     */
    get total() {
        return this._total
    }

    
    /**
     * Shuts down the pool and closes all active connections.
     * 
     * All pending `acquire()` calls will be rejected with an error.
     * The pool cannot be used after calling `close()`.
     * 
     * @example
     * ```ts
     *  pool.close()
     * ```
     */
    close() {
        while (this._available.hasMore) {
            const conn = this._available.get()
            this._available.next()
            conn.close()
        }

        while (this._waiting.hasMore) {
            const waiter = this._waiting.get()
            this._waiting.next()
            waiter.reject(new Error('Pool closed'))
        }

        this._total = 0
    }
}