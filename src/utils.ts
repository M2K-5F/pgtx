import { Clause } from "./clauses/abstract.clause"
import { ClauseStrategyParams, CompiledSqlQuery, CompileSQLParams } from "./types"



export function compileSqlTemplate(params: Readonly<CompileSQLParams>): CompiledSqlQuery {
    const templateLength = params.templates.length
            
    const query: ClauseStrategyParams = {
        text: [],
        args: [],
        counter: params.counter
    }

    params.templates.forEach((template, index) => {
        query.text.push(template)

        if (index === templateLength - 1) return

        const value = params.args[index]

        if (value instanceof Clause) {
            value.mapIntoQuery(query)
        } else {
            if (value === undefined) {
                throw new TypeError(
                    `Query parameter at position ${query.counter} is undefined. 
                    Use null if you want NULL in SQL, or ensure the value is defined.`
                )
            }

            query.args.push(value)
            query.text.push(`$${query.counter++}`)
        }
    })
    
    return {...query, text: query.text.join('')}
}