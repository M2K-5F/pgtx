import { Clause } from "./base.clause";
import { CompiledSqlQuery } from "./utils";

export class IdentifierClause<T extends string> extends Clause {
    constructor(
        readonly value: T
    ) {super()}

    override map(argCounter: number): CompiledSqlQuery {
        const text = `"${this.value}"`
        const args: any[] = []
        
        return { text, args, argCounter}
    }
}

export function identClause<T extends string>(identificator: T) {
    return new IdentifierClause<T>(identificator)
}