import { Clause } from "./base.clause";
import { CompiledSqlQuery } from "../utils";

export class InsertClause<T extends Record<string, any>> extends Clause {
    constructor(
        readonly inserts: T[]
    ) {super()}

    override map(argCounter: number): CompiledSqlQuery {
        if (this.inserts.length === 0) {
            throw new Error(
                'Insert clause has no rows to insert.\n' +
                'Provide at least one object with data.'
            )
        }

        const columns = Object.keys(this.inserts[0])
        const columnsCount = columns.length

        let text: string = `(${columns.join(', ')}) VALUES `
        let args: any[] = []


        const valuesText = this.inserts.map(values => {
            if (Object.keys(values).length !== columnsCount) throw new Error(`
                all rows must have the same columns
            `)

            return `(${Object.values(values).map(value => {
                if (value === undefined) return "DEFAULT"

                args.push(value)
                return `$${argCounter++}`
            }).join(", ")})`
        }).join(", ")
        
        text += valuesText

        return {text, args, argCounter}
    }
}

export function insertClause<T extends Record<string, any>>(...objects: NoInfer<T>[]) {
    return new InsertClause<T>(objects)
}