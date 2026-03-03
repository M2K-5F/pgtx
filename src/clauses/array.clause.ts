import { Clause } from "../clauses/base.clause";
import { CompiledSqlQuery } from "../utils";

export class ArrayClause extends Clause {
    constructor(
        private readonly array: any[],
        private readonly separator: string = ", "
    ) { super() }

    override map(argCounter: number): CompiledSqlQuery {
        if (this.array.length === 0) throw new Error(
            'Array clause is empty.\n Use sql.array([null]) if you want no results, or check your data.'
        )

        const args: any[] = []  
        
        const text = `${this.array.map((value, index) => {
            if (value === undefined) {
                throw new TypeError(`Array item at index ${index} is undefined`)
            }
            
            if (value instanceof Clause) {
                const result = value.map(argCounter)
                args.push(...result.args)
                argCounter = result.argCounter
                return result.text
            } else {
                args.push(value)
                return `$${argCounter++}`
            }
        }).join(this.separator)}`
        
        return {text, args, argCounter}
    }
}

export function arrayClause(array: any[], separator: string = ", "): ArrayClause {
    return new ArrayClause(array, separator)
}