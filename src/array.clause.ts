import { Clause } from "./base.clause";
import { CompiledSqlQuery } from "./utils";

export class ArrayClause extends Clause {
    constructor(
        private readonly array: any[],
        private separator: string = ", "
    ) { super() }

    override map(argCounter: number): CompiledSqlQuery {
        if (this.array.length === 0) return {text: 'NULL', args: [], argCounter}

        const args: any[] = []  
        
        const text = `${this.array.map(value => {
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

export function arrayClause(array: any[]): ArrayClause {
    return new ArrayClause(array)
}