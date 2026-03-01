import { AnyActionArg } from "react";
import { Clause } from "./base.clause";
import { CompiledSqlQuery } from "./utils";

export class UpdateClause<T extends Record<string, any>> extends Clause {
    constructor(
        readonly updateMap: T,
        readonly columns?: (keyof T)[]
    ) { super() }

    override map(argCounter: number): CompiledSqlQuery {
        const columns = this.columns || (Object.keys(this.updateMap) as (keyof T)[])
        
        const args: any[] = []

        const text = columns
            .map((key) => {
                args.push(this.updateMap[key])
                return `${key.toString()} = $${argCounter++}`
            }).join(', ')


        return {text, args, argCounter}

    }
}

export function updateClause<T extends Record<string, any>>(object: T, ...updateColumns: (keyof T)[]): UpdateClause<T> {
    return new UpdateClause(object, updateColumns.length > 0 ? updateColumns : undefined)
}
