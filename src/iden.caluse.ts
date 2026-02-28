import { Clause, SQLWithArgs } from "./base.clause";

export class IdentifierClause<T extends string> extends Clause {
    constructor(
        readonly value: T
    ) {super()}

    override map(currentArgCounter: number): SQLWithArgs {
        return { template: `"${this.value}"`, args: [], counter: currentArgCounter }
    }
}

export function identClause<T extends string>(identificator: T) {
    return new IdentifierClause<T>(identificator)
}