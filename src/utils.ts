import { Clause } from "./clauses/abstract.clause"
import { ClauseStrategyParams, CompiledSqlQuery, CompileSQLParams } from "./types"



export function compileSqlTemplate(params: Readonly<CompileSQLParams>, argOffset = 0): CompiledSqlQuery {
    const templateLength = params.templates.length
            
    const query: ClauseStrategyParams = {
        text: [],
        args: [],
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
                    `Query parameter at position ${query.args.length + argOffset + 1} is undefined. 
                    Use null if you want NULL in SQL, or ensure the value is defined.`
                )
            }

            query.args.push(value)
            query.text.push(`$${query.args.length + argOffset}`)
        }
    })
    
    return {...query, text: query.text.join('')}
}