import { ClauseStrategyParams } from "../types";
import { Clause } from "./abstract.clause";

export class UpdateClause<T extends Record<string, any>> extends Clause {
    constructor(
        readonly updateMap: T,
    ) { super() }

    static create<T extends Record<string, any>>(object: T) {
        return new UpdateClause<T>(object)
    }

    override mapIntoQuery(params: ClauseStrategyParams) {
        const entries = Object.entries(this.updateMap).filter(([_, value]) => value !== undefined)

        if (entries.length === 0) throw new Error('Update clause has no data to update. All values are `undefined`')

            
        entries.forEach(([key, value], index) => {
            if (index) params.text.push(', ')
            
            params.args.push(value)
            params.text.push(`${key} = $${params.counter++}`)
        })
    }
}