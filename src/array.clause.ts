import { Clause } from "./base.clause";
import { CompiledSqlQuery } from "./utils";

export class ArrayClause<T extends any[]> extends Clause {
    constructor(
        private readonly array: T
    ) { super() }

    override map(argCounter: number): CompiledSqlQuery {
        if (this.array.length === 0) return {text: '(NULL)', args: [], argCounter}
        const args: any[] = []  
        
        const text = `(${this.array.map(value => {
            args.push(value)
            return `$${argCounter++}`
        }).join(", ")})`
        
        return {text, args, argCounter}
    }
}

export function arrayClause<T extends any[]>(array: T): ArrayClause<T> {
    return new ArrayClause<T>(array)
}