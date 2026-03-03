import { AnyActionArg } from "react";
import { Clause } from "./base.clause";
import { CompiledSqlQuery } from "../utils";

export class UpdateClause<T extends Record<string, any>> extends Clause {
    constructor(
        readonly updateMap: T,
    ) { super() }

    override map(argCounter: number): CompiledSqlQuery {        
        const args: any[] = []

        const entries = Object.entries(this.updateMap).filter(([_, value]) => value !== undefined)

        if (entries.length === 0) throw new Error('Update clause has no data to update. All values are `undefined`')

        const text = entries.map(([key, value]) => {
            args.push(value)
            return `${key} = $${argCounter++}`
        }).join(', ')

        return {text, args, argCounter}
    }
}

export function updateClause<T extends Record<string, any>>(object: T) {
    return new UpdateClause<T>(object)
}