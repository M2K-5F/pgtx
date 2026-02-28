import { Clause, SQLWithArgs } from "./base.clause";

export class InsertClause extends Clause {
    constructor(
        readonly inserts: Record<string, any>[]
    ) {super()}

    override map(currentArgCounter: number): SQLWithArgs {
        const columns = Object.keys(this.inserts[0])

        let template: string = `(${columns.join(', ')}) VALUES `
        let args: any[] = []

        
        template += `${this.inserts.map(values => {

            return `(${Object.values(values).map(value => {
                currentArgCounter++
                args.push(value)
                return `$${currentArgCounter - 1}`
            }).join(", ")})`
        }).join(", ")}`

        return {template, args, counter: currentArgCounter}
    }
}

export function valueClause<T extends Record<string, any>>(...objects: [T, ...NoInfer<T>[]]) {
    return new InsertClause(objects)
}