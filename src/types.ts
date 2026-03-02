import { PoolConfig as PgPoolConfig } from "pg"

export type PoolConfig = PgPoolConfig

export type PreparedStatement<TResult extends any, Tparams extends any[]> = {
    text: string, 
    name: string,
    execute: (...args: Tparams) => Promise<TResult[]>
}