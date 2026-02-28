import { PoolClient, PoolConfig, QueryResultRow } from "pg"

export type Connection = PoolClient 

export interface Transaction {
    query: <T extends QueryResultRow>(strings: TemplateStringsArray, ...values: any[]) => Promise<T[]>
}

export type QueryBuild = {
    text: string,
    args: any[]
}

export type PgtxPoolConfig = PoolConfig