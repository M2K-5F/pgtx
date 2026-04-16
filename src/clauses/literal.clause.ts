import { ClauseStrategyParams } from "../types";
import { Clause} from "./abstract.clause";

export class LiteralClause<T extends string> extends Clause {
    constructor(
        readonly value: T
    ) {
        super()
    }

    static create<T extends string>(value: T): LiteralClause<T> {
        if (value === undefined) {
            throw new TypeError(`Literal undefined`)
        }

        return new LiteralClause(value)
    }

    override mapIntoQuery(params: ClauseStrategyParams) {
        params.text.push(this.value)
    }
}