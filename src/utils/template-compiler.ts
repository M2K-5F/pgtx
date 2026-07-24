import { Clause } from "../clauses/abstract.clause"
import { ClauseStrategyParams, CompiledSqlQuery, CompileSQLParams } from "../types"



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
    
    return {args: query.args.map(prepareValue), text: query.text.join('')}
}


const prepareValue = (value: unknown): string | null => {
    if (value === null || value === undefined) {
        return null
    }
    
    if (typeof value === 'object') {
        if (value instanceof Date) {
            return value.toISOString()
        }

        if (Array.isArray(value)) {
            const elements = value.map(el => {
                if (el === null || el === undefined) return 'NULL'
                if (typeof el === 'boolean') return el ? 'true' : 'false'
                
                if (typeof el === 'object') {
                    const res = prepareValue(el)
                    return `"${res?.replace(/"/g, '\\"')}"`
                }
                
                if (typeof el === 'string') {
                    return `"${el.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
                }
                return String(el)
            })
            return `{${elements.join(',')}}`
        }

        return prepareObject(value)
    }

    return value.toString()
}


const prepareObject = (obj: any): string => {
    if (obj && typeof obj.toPG === 'function') {
        return JSON.stringify(obj.toPG())
    }

    return JSON.stringify(obj)
}


