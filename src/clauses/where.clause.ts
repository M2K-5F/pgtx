import { Clause } from "./abstract.clause";
import { ClauseStrategyParams } from "../types";

export class WhereClause<T extends Record<string, any>> extends Clause {
    constructor(
        private _value: T,
    ) { super() }

    public static create<T extends Record<string, any>>(whereMap: T) {
        return new WhereClause<T>(whereMap)
    }

    override mapIntoQuery(params: ClauseStrategyParams) {
        const entries = Object.entries(this._value).filter(([_, value]) => value !== undefined)

        if (entries.length === 0) throw new Error('Where clause has no data to update. All values are `undefined`')
            
        entries.forEach(([key, value], index) => {
            if (index) params.text.push(' AND ')
            
            params.args.push(value)
            params.text.push(`${key} = $${params.counter++}`)
        })
    }
}