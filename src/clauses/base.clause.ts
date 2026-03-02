import { CompiledSqlQuery } from "./../utils";

export abstract class Clause {
    abstract map(argCounter: number): CompiledSqlQuery
}