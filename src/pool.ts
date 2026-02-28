import {Pool, QueryResultRow} from "pg"
import { Connection, PgtxPoolConfig, QueryBuild, Transaction } from "./types"
import { QueryBuilder } from "./query.builder"

const builder = new QueryBuilder()

export class PgtxPool {
    private pool: Pool

    constructor(
        config: PgtxPoolConfig
    ) {
        this.pool = new Pool(config)
    }

    public async query<T extends QueryResultRow>(strings: TemplateStringsArray, ...values: any[]) {
        const {text, args} = builder.cachedBuild(strings, values)
        return (await this.pool.query<T>(text, args)).rows
    }

    public async begin<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
        const tx = await this.pool.connect()

        const txQuerier = new Querier(tx)

        try {
            await tx.query("BEGIN")

            const result = await callback(txQuerier)

            await tx.query("COMMIT")

            return result
        } 
        catch (err) {
            await tx.query("ROLLBACK")
            throw err
        }
        finally {
            tx.release()
        }
    }
}

export class Querier {
    constructor(
        readonly client: Connection
    ) {}
    
    public async query<T extends QueryResultRow = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]> {
        const {text, args} = builder.cachedBuild(strings, values)

        const result = await this.client.query<T>(text, args)

        return result.rows
    }
}

