import { PoolConfig as PgPoolConfig } from "pg"

export type PoolConfig = PgPoolConfig & {enableLogs?: boolean}

export type PreparedStatement<TResult extends any, Tparams extends any[]> = {
    text: string, 
    name: string,
    execute: (...args: Tparams) => Promise<TResult[]>
}

export type CompiledSqlQuery = {
    text: string, 
    args: any[],
    counter: number
}

export type ClauseStrategyParams = {
    text: string[],
    args: any[],
    counter: number
}

export type CompileSQLParams = {
    templates: TemplateStringsArray,
    args: any[],
    counter: number
}
