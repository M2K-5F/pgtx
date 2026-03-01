import {Pool, QueryResultRow} from "pg"
import { Connection, PgtxPoolConfig, Transaction } from "./types"
import { QueryCacher } from "./query.cacher"

const cacher = new QueryCacher()

export class PgtxPool {
    private pool: Pool

    constructor(
        config: PgtxPoolConfig
    ) {
        this.pool = new Pool(config)
    }

    public async query<T extends QueryResultRow>(strings: TemplateStringsArray, ...values: any[]) {
        const {text, args} = cacher.cachedBuild(strings, values)
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

    public close() {
        return this.pool.end()
    }
}

export class Querier {
    constructor(
        readonly client: Connection
    ) {}
    
    public async query<T extends QueryResultRow = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]> {
        const {text, args} = cacher.cachedBuild(strings, values)

        const result = await this.client.query<T>(text, args)

        return result.rows
    }
}

