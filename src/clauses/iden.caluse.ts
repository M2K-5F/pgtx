import { ClauseStrategyParams } from "../types"
import { Clause } from "./abstract.clause"

export class IdentifierClause<T extends string> extends Clause {
    constructor(
        readonly value: T
    ) {super()}

    static create<T extends string>(identificator: T) {
        if (identificator === undefined) throw new TypeError("Identificator undefined")

        return new IdentifierClause<T>(identificator)
    }

    override mapIntoQuery(params: ClauseStrategyParams) {
        params.text.push(`"${this.value}"`)
    }
}