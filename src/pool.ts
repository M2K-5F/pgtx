import { Pool as PgPool, QueryResultRow} from "pg";
import { PoolConfig, PreparedStatement } from "./types"
import { Connection } from "./connection"
import { Transaction } from "./transaction"

/**
 * The main entry point for Pgtx. 
 * Manages a connection pool and provides high-level API for queries and transactions.
 */
export class Pool {
    private pool: PgPool

    constructor(
        config: PoolConfig
    ) {
        this.pool = new PgPool(config)
    }

    /**
     * Executes a one-off query. 
     * Automatically acquires and releases a connection from the pool.
     * 
     * @example
     * const users = await pool.query<User>`SELECT * FROM users WHERE id = ${1}`;
     */
    public async query<T extends QueryResultRow>(strings: TemplateStringsArray, ...values: any[]) {
        const conn = await this.acquire()

        try {
            return await conn.query<T>(strings, ...values)
        }
        catch (err) {
            throw err
        }
        finally {
            conn.release()
        }
    }

    /**
     * Creates a reusable prepared statement.
     * When executed via `stmt.execute()`, it automatically manages its own connection.
     * Maps '?' placeholders to native PostgreSQL '$1, $2' indexes.
     * 
     * @example
     * const stmt = await pool.prepare<User, [string]>('get_user', 'SELECT * FROM users WHERE email = ?');
     * const users = await stmt.execute('test@example.com');
     */
    public async prepare<TResult extends QueryResultRow = any, TParams extends any[] = any[]>(
        name: string,
        sqlTemplate: string
    ): Promise<PreparedStatement<TResult, TParams>> {
        
        let index = 1
        const text = sqlTemplate.replace(/\?/g, () => `$${index++}`)

        return {
            text,
            name,
            execute: async (...args: TParams) => {
                const conn = await this.acquire()
                conn['checkActive']()
                try {
                    const result = await conn['client'].query<TResult>({
                        name,
                        text,
                        values: args
                    })
                    return result.rows
                } finally {
                    conn.release()
                }
            }
        }
    }

    /**
     * Acquires a dedicated connection from the pool.
     * **Note:** You must call `connection.release()` manually when finished.
     */
    public async acquire(): Promise<Connection> {
        const client = await this.pool.connect()
        return new Connection(client)
    }

    /**
     * Starts a managed transaction. 
     * Automatically acquires a connection and handles BEGIN/COMMIT/ROLLBACK.
     * 
     * @example
     * const result = await pool.begin(async (tx) => {
     *   await tx.query`INSERT INTO accounts ...`;
     *   return "success";
     * });
     */
    public async begin<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
        const conn = await this.acquire()

        try {
            return await conn.begin(callback)
        }
        catch (err) {
            throw err
        }
        finally {
            conn.release()
        }
    }

    /**
     * Returns current pool utilization statistics.
     */
    public get stats() {
        return {
            total: this.pool.totalCount,
            idle: this.pool.idleCount,
            waiting: this.pool.waitingCount
        }
    }

    /**
     * Shuts down the pool and closes all active connections.
     */
    public close() {
        return this.pool.end()
    }
}
