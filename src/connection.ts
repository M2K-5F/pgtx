import { PoolClient, QueryResultRow } from "pg"
import { PreparedStatement } from "./types"
import { Transaction } from "./transaction"
import { QueryCacher } from "./query.cacher"
import { ConnPraparedStatement } from "./prepared.statement"

const cacher = new QueryCacher()

/**
 * Represents a single dedicated connection to the database.
 * Always remember to call `.release()` when finished.
 */
export class Connection {
    private isReleased: boolean = false

    constructor(
        private readonly client: PoolClient,
        private readonly enableLogs: boolean
    ) {}

    /**
     * Checks if the connection is still open and not returned to the pool.
     */
    public get isActive(): boolean {
        return !this.isReleased
    }

    /**
     * Creates a prepared statement on this specific connection.
     * Maps '?' placeholders to native PostgreSQL '$1, $2' indexes.
     * 
     * @example
     * const stmt = await conn.prepare('get_user', 'SELECT * FROM users WHERE id = ?');
     * const rows = await stmt.execute(1);
     */
    public async prepare<TResult extends QueryResultRow, TParams extends any[] = []>(
        name: string,
        sqlTemplate: string
    ): Promise<PreparedStatement<TResult, TParams>> {
        
        let index = 1
        const text = sqlTemplate.replace(/\?/g, () => `$${index++}`)

        return new ConnPraparedStatement(
            this.client,
            text,
            name
        )
    }

    /**
     * Releases the connection back to the pool. 
     * The connection cannot be used after this call.
     */
    public async release(): Promise<void> {
        if (this.isReleased) return
        this.isReleased = true
        this.client.release()
    }

    private checkActive(): void {
        if (this.isReleased) {
            throw new Error("Connection has been released")
        }
    }

    /**
     * Executes a tagged SQL query using structural caching.
     * Supports recursive fragments and clauses.
     * 
     * @example
     * const users = await conn.query`SELECT * FROM users WHERE id = ${1}`;
     */
    public async query<T extends QueryResultRow = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]> {
        this.checkActive()

        const {text, args} = cacher.cachedBuild({
            templates: strings,
            args: values,
            counter: 1
        })

        if (this.enableLogs) {
            console.log(`\nQUERY:     ${text}\n${args.length ? `ARGUMENTS: [${args}]\n` : ""}`)
        }

        const result = await this.client.query<T>(text, args)

        return result.rows
    }

    /**
     * Starts a managed transaction on this connection.
     * Handles automatic COMMIT on success or ROLLBACK on error.
     * 
     * @example
     * await conn.begin(async (tx) => {
     *   await tx.query`INSERT INTO logs ...`;
     * });
     */
    public async begin<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
        this.checkActive()

        const tx = new Transaction(this)

        try {
            await tx.query`BEGIN`

            const result = await callback(tx)

            if (tx.isActive) await tx.commit()

            return result
        } 
        catch (err) {
            if (tx.isActive) await tx.rollback()
            throw err
        }
    }
}
