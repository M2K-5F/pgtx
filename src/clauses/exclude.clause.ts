import { ClauseStrategyParams } from "../types";
import { Clause } from "./abstract.clause";

export class ExcludeUpdateClause extends Clause {
    private constructor(
        readonly fields: string[],
    ) { super() }

    static create(fields: string[]): ExcludeUpdateClause {
        return new ExcludeUpdateClause(fields)
    }

    public mapIntoQuery(params: ClauseStrategyParams) {
        params.text.push(
            this.fields.map(f => `${f} = EXCLUDED.${f}`)
                .join(', ')
        )
    }
}