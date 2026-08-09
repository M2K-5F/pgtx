import { Connection, ConnectionParams } from "./connection"
import { Transaction } from "./transaction"
import { Queue } from "./queue";
import { log } from "console";
import { Begin, Future, Ok } from "fluent-future";
import { PostgresError } from "./error";


type PoolParams = ConnectionParams & {
    max?: number
}


const ErrPoolClosed = new PostgresError('Pool closed')


type Waiter = {
    resolve: (conn: Connection) => void
    reject: (err: PostgresError) => void
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
            const conn = this._available.shift

            if (conn.isOpened) {
                return Ok(conn)
            }
            this._total--
        }

        if (this._total < this._max) {
            this._total++
            return Connection.new(this._config)
                .tapErr(() => this._total--)
            
        }

        const {future, reject, resolve} = Future.withResolvers<Connection, PostgresError>()

        this._waiting.push({ resolve, reject })

        return future
    }


    /**
     * Provides a safe execution context for performing low-level operations 
     * directly on a single, dedicated `Connection` instance.
     * 
     * Automatically borrows a free socket from the pool, forwards it to the provided callback function, 
     * and guarantees that the connection is released back to the pool once the execution completes, 
     * even if errors or unexpected exceptions are thrown. Prevents connection descriptor leaks.
     *
     * @template T The return type of the provided callback function.
     * @param {(conn: Connection) => Promise<T>} fn A callback function that operates on the allocated Connection.
     * @returns {Future<T, PostgresError>} A `Future` that resolves with the return value of the callback.
     * 
     * @example
     * // Executing low-level engine commands on a single, pinned connection
     * const status = await pool.withAcquire(async (conn) => {
     *     return await conn.query`SELECT pg_is_in_recovery()`;
     * });
     */
    withAcquire<T>(fn: (conn: Connection) => Promise<T>) {
        return Begin()
            .andThen(() => this.acquire())
            .andThen(conn => 
                Future.of(fn(conn))
                    .finally(() => this.release(conn))
            )
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
            this._waiting.shift.resolve(conn)
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

        return Begin()
            .andThen(() => this.acquire())
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
            const conn = this._available.shift

            if (!conn.isOpened) {
                this._total--
                continue
            }

            this._available.push(conn)
            return conn.query<T>(templates, ...args)
        }

        return this.acquire()
            .andThen(conn => {
                this.release(conn) 
                return conn.query<T>(templates, ...args)
            })
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
     * const userStream = pool.stream<User>`SELECT id, name FROM users`;
     * return new Response(userStream, { headers: { 'Content-Type': 'application/json' } });
     * 
     * @example
     * // Asynchronously iterating over rows as they arrive from the wire socket
     * const stream = pool.stream<User>`SELECT * FROM orders WHERE status = ${'processed'}`;
     * for await (const row of stream) {
     *     console.log(row.id, row.amount); // Row object is eligible for GC immediately after iteration
     * }
     */
    stream<T extends Record<string, any>>(templates: TemplateStringsArray, ...args: any[]): ReadableStream<T> {  
        this._checkClosed()

        while (this._available.hasMore) {
            const conn = this._available.shift

            if (!conn.isOpened) {
                this._total--
                continue
            }

            this._available.push(conn)
            return conn.stream<T>(templates, ...args)
        }

        let controller!: ReadableStreamDefaultController<T>
        
        const stream = new ReadableStream<T>({
            start: c =>  {
                controller = c
            }
        })

        this.acquire()
            .tap(conn => {
                this.release(conn) 
                conn['_streamWithController']<T>(templates, args, controller)
            })
            .catch(err => {
                controller.error(err)
            })

        return stream
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
     * Asynchronously subscribes to pub/sub events on a specific PostgreSQL channel (LISTEN).
     * 
     * This method automatically claims a dedicated connection from the pool, registers the callback 
     * to handle incoming asynchronous database notices (`NotificationResponse` packets), and returns 
     * a lazy unsubscribe function wrapped in a `Future`.
     * 
     * Invoking the returned unsubscribe function will automatically issue the `UNLISTEN` command 
     * to the database backend, clean up the memory callback, and safely release the connection back to the pool.
     *
     * @param {string} channel The name of the PostgreSQL notification channel.
     * @param {(payload: string) => void} callback The event handler invoked when a NOTIFY message arrives.
     * @returns {Future<() => Promise<void>, PostgresError>} A `Future` resolving to an async unsubscribe function.
     * 
     * @example
     * // Subscribing to database events directly from the Pool
     * const unlisten = await pool.listen('order_created', (payload) => {
     *     const order = JSON.parse(payload);
     *     console.log(`New order received: ${order.id}`);
     * });
     * 
     * // When the subscription is no longer needed (e.g., during teardown or server stop):
     * await unlisten(); // The socket cleanly issues UNLISTEN and returns to the pool of free connections.
     */
    listen(channel: string, callback: (payload: string) => void) {
        return this.acquire()
            .andThen(conn => 
                conn.listen(channel, callback)
                    .map(() => async () => {
                        await conn.unlisten(channel, callback)
                        this.release(conn)
                    })
            )
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
            this._available.shift.close()
        }

        while (this._waiting.hasMore) {
            this._waiting.shift.reject(ErrPoolClosed)
        }

        this._total = 0
    }
}