import { QueryResultRow } from "pg"
import { Connection } from "./connection"
import { identClause } from "./clauses/iden.caluse"
import { PreparedStatement } from "./types"

/**
 * Represents an active SQL transaction.
 * All queries are executed on a single dedicated connection.
 */
export class Transaction {
    private isFinished: boolean = false

    constructor(
        readonly conn: Connection
    ) {}

    /**
     * Returns true if the transaction is still open (not committed or rolled back).
     */
    public get isActive(): boolean {
        return !this.isFinished
    }

    private checkActive(): void {
        if (this.isFinished) {
            throw new Error("Transaction is finished")
        }
    }
    
    /**
     * Commits the current transaction.
     */
    public async commit(): Promise<void> {
        this.checkActive()

        await this.conn.query`COMMIT`
        this.isFinished = true
    }

    /**
     * Rolls back the current transaction.
     */
    public async rollback(): Promise<void> {
        this.checkActive()

        await this.conn.query`ROLLBACK`
        this.isFinished = true
    }
    
    /**
     * Executes a query within the current transaction.
     */
    public async query<T extends QueryResultRow = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]> {
        this.checkActive()
        return await this.conn.query<T>(strings, ...values)
    }

    /**
     * Creates a sub-transaction using PostgreSQL SAVEPOINT.
     * If the callback throws, only the actions within this savepoint are rolled back.
     * 
     * @example
     * await tx.savepoint('my_point', async (stx) => {
     *   await stx.query`INSERT ...`;
     *   if (error) throw new Error(); // Only this insert rolls back
     * });
     */
    public async savepoint(name: string, callback: (tx: Transaction) => Promise<void>): Promise<void> {
        this.checkActive()

        await this.conn.query`SAVEPOINT ${identClause(name)}`

        try {
            await callback(this)
            await this.conn.query`RELEASE SAVEPOINT ${identClause(name)}`
        }
        catch (err) {
            await this.conn.query`ROLLBACK TO SAVEPOINT ${identClause(name)}`
            throw err
        }
    }
}
