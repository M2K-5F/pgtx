import { Clause } from "./base.clause";
import { CompiledSqlQuery } from "./utils";

export class InsertClause extends Clause {
    constructor(
        readonly inserts: Record<string, any>[]
    ) {super()}

    override map(argCounter: number): CompiledSqlQuery {
        const columns = Object.keys(this.inserts[0])

        let text: string = `(${columns.join(', ')}) VALUES `
        let args: any[] = []

        
        text += `${this.inserts.map(values => {
            return `(${Object.values(values).map(value => {
                args.push(value)
                return `$${argCounter++}`
            }).join(", ")})`
        }).join(", ")}`

        return {text, args, argCounter}
    }
}

export function valueClause<T extends Record<string, any>>(...objects: [T, ...NoInfer<T>[]]) {
    return new InsertClause(objects)
}