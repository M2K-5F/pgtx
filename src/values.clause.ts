import { Clause, SQLWithArgs } from "./base.clause";

export class InsertClause extends Clause {
    constructor(
        readonly columns: string[],
        readonly inserts: any[][]
    ) {super()}

    override map(currentArgCounter: number): SQLWithArgs {
        let template: string = `(${this.columns.join(', ')}) VALUES `
        let args: any[] = []

        
        template += `${this.inserts.map(values => {

            return `(${values.map(value => {
                currentArgCounter++
                args.push(value)
                return `$${currentArgCounter - 1}`
            }).join(", ")})`
        }).join(", ")}`

        return {template, args, counter: currentArgCounter}
    }
}

export function valueClause<T extends Record<string, any>, U extends T>(...objects: [T, ...U[]]) {
    const columns = Object.keys(objects[0])

    const values = objects.map(obj => columns.map(col => obj[col]))

    return new InsertClause(columns, values)
}