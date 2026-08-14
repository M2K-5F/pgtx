import { Clause } from "../clauses/abstract.clause"
import { ClauseStrategyParams, CompiledSqlQuery, CompileSQLParams } from "../types"

const cache = new WeakMap<TemplateStringsArray, string>()

export function compileSqlTemplate(templates: TemplateStringsArray, args: unknown[], argOffset = 0): CompiledSqlQuery {
    const cached = cache.get(templates)
    if (cached) return {args: args.map(prepareValue), text: cached}
    
    const templateLength = templates.length
            
    const query: ClauseStrategyParams = {
        text: '',
        args: [],
    }

    templates.forEach((template, index) => {
        query.text += template

        if (index === templateLength - 1) return

        const value = args[index]

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
            query.text += `$${query.args.length + argOffset}`
        }
    })

    !args.some(value => value instanceof Clause) && cache.set(templates, query.text)
    
    return {args: query.args.map(prepareValue), text: query.text}
}


const prepareValue = (value: unknown): string | null => {
    if (value === null || value === undefined) {
        return null
    }
    
    if (typeof value === 'object') {
        if (value instanceof Date) {
            return value.toISOString()
        }

        if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
            return '\\x' + Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('hex')
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


