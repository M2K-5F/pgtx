import { PoolClient, PoolConfig, QueryResultRow } from "pg"

export type Connection = PoolClient 

export interface Transaction {
    query: <T extends QueryResultRow>(strings: TemplateStringsArray, ...values: any[]) => Promise<T[]>
}

export type PgtxPoolConfig = PoolConfig