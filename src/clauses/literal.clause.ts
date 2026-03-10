import { Clause} from "./base.clause";
import { CompiledSqlQuery } from "../utils";

export class LiteralClause<T extends string> extends Clause {
    constructor(
        readonly value: T
    ) {
        super()
    }

    override map(argCounter: number): CompiledSqlQuery {
        if (this.value === undefined) {
            throw new TypeError(`Query parameter undefined at position ${argCounter}`)
        }
        return {text: this.value, args: [], argCounter}
    }
}


export function literalClause<T extends string>(value: T): LiteralClause<T> {
    return new LiteralClause(value)
}