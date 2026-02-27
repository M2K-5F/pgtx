import { AnyActionArg } from "react";
import { Clause, SQLWithArgs } from "./base.clause";

export class UpdateClause<T extends Record<string, any>> extends Clause {
    constructor(
        readonly updateMap: T,
        readonly columns?: (keyof T)[]
    ) { super() }

    override map(currentArgCounter: number): SQLWithArgs {
        const columns = this.columns || (Object.keys(this.updateMap) as (keyof T)[])
        
        const args: any[] = []

        const template = columns
            .map((key, index) => {
                args.push(this.updateMap[key])
                return `${key.toString()} = $${currentArgCounter + index}`
            }).join(', ')


        return {template, args, counter: currentArgCounter}

    }
}

export function updateClause<T extends Record<string, any>>(object: T, ...updateColumns: (keyof T)[]): UpdateClause<T> {
    return new UpdateClause(object, updateColumns.length > 0 ? updateColumns : undefined)
}
