import { Begin, Future } from "fluent-future"
import { IdentifierClause } from "./clauses"
import { Connection } from "./connection"
import { ErrTransactionClosed, PostgresError } from "./error"

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
    
    /**
     * Commits the current transaction.
     */
    public commit() {
        if (this.isFinished) return Future.reject(ErrTransactionClosed)

        return this.conn.query`COMMIT`
            .tap(() => this.isFinished = true)
            .map(() => {})
    }

    /**
     * Rolls back the current transaction.
     */
    public rollback() {
        if (this.isFinished) return Future.reject(ErrTransactionClosed)

        return this.conn.query`ROLLBACK` 
            .tap(() => this.isFinished = true)
            .map(() => {})
    }
    
    /**
     * Executes a query within the current transaction.
     */
    public query<T extends Record<string, any>>(strings: TemplateStringsArray, ...values: any[]) {
        if (this.isFinished) return Future.reject(ErrTransactionClosed)

        return this.conn.query<T>(strings, ...values)
    }

    /**
     * Creates a sub-transaction using PostgreSQL SAVEPOINT.
     * If the callback throws, only the actions within this savepoint are rolled back.
     * 
     * @example
     * await tx.savepoint('my_point', async (stx) => {
     *   await stx.query`INSERT ...`;
     *   if (error) throw new Error() // Only this insert rolls back
     * });
     */
    public savepoint<T>(name: string, callback: (tx: Transaction) => Promise<T>) {
        if (this.isFinished) return Future.reject(ErrTransactionClosed)

        return Begin<PostgresError>()
            .andThen(() =>this.conn.query`SAVEPOINT ${IdentifierClause.create(name)}`)
            .andThen(() => 
                Future.of(callback(this), )
                    .tap(() => this.conn.query`RELEASE SAVEPOINT ${IdentifierClause.create(name)}`)
                    .tapErr(() => this.conn.query`ROLLBACK TO SAVEPOINT ${IdentifierClause.create(name)}`)
            )   
    }
}
