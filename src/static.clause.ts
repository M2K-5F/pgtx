import { Clause, SQLWithArgs } from "./base.clause";

export class StaticClause extends Clause {
    constructor(
        readonly value: string
    ) {
        super()
    }

    override map(currentArgCounter: number): SQLWithArgs {
        return {template: this.value, args: [], counter: currentArgCounter}
    }
}


export function staticClause(value: any): StaticClause {
    return new StaticClause(String(value))
}