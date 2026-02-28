import { Clause, SQLWithArgs } from "./base.clause";

export class StaticClause<T extends string> extends Clause {
    constructor(
        readonly value: T
    ) {
        super()
    }

    override map(currentArgCounter: number): SQLWithArgs {
        return {template: this.value, args: [], counter: currentArgCounter}
    }
}


export function staticClause<T extends string>(value: T): StaticClause<T> {
    return new StaticClause(value)
}