import { ClauseStrategyParams } from "../types";
import { Clause } from "./abstract.clause";

export class ArrayClause extends Clause {
    private constructor(
        private readonly array: any[],
        private readonly separator: string = ", "
    ) { super() }

    static create(array: any[], separator: string = ", "): ArrayClause {
        if (array.length === 0) throw new Error(
            'Array clause is empty.\n Use sql.array([null]) if you want no results, or check your data.'
        )

        return new ArrayClause(array, separator) 
    }

    override mapIntoQuery(params: ClauseStrategyParams) {
        this.array.forEach((value, index) => {
            if (value === undefined) {
                throw new TypeError(`Array item at index ${index} is undefined`)
            }

            if (index) params.text.push(this.separator)

            if (value instanceof Clause) {
                value.mapIntoQuery(params)
            } 
            else {
                params.args.push(value)
                params.text.push(`$${params.counter++}`)
            }
        })
    }
}