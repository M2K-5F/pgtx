import { DataTypeOid } from "./protocol/constants"

export type PreparedStatement<TResult extends any, Tparams extends any[]> = {
    text: string, 
    name: string,
    execute: (...args: Tparams) => Promise<TResult[]>
}

export type CompiledSqlQuery = {
    text: string, 
    args: (string | null)[],
}

export type ClauseStrategyParams = {
    text: string[],
    args: any[],
}

export type CompileSQLParams = {
    templates: TemplateStringsArray,
    args: any[],
}


export type ColumnDescription = {
    name: string
    typeOID: DataTypeOid
}

export type Branded<T, Brand> = T & {__brand: Brand}

export type ValueOF<T extends Record<string, unknown>> = T[keyof T]