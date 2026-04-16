import { Clause } from "./abstract.clause";
import { ClauseStrategyParams } from "../types";

export class InsertClause<T extends Record<string, any>> extends Clause {
    constructor(
        readonly inserts: T[]
    ) {super()}

    static create<T extends Record<string, any>>(...objects: NoInfer<T>[]) {
        if (objects.length === 0) {
            throw new Error('Insert clause has no rows to insert.\n Provide at least one object with data.')
        }
        return new InsertClause<T>(objects)
    }

    override mapIntoQuery(params: ClauseStrategyParams) {
        const columns = Object.keys(this.inserts[0])
        const columnsCount = columns.length

        params.text.push(`(${columns.join(', ')}) VALUES `)

        this.inserts.forEach((object, index) => {
            if (Object.keys(object).length !== columnsCount) {
                throw new Error(`all rows must have the same columns`)
            }

            if (index) params.text.push(', ')
            

            params.text.push(
                `(${Object.values(object).map(value => {
                    if (value === undefined) return "DEFAULT"
                    
                    params.args.push(value)
                    return `$${params.counter++}`
                })
                    .join(", ")})`
            )
        })
    }
}