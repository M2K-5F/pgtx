import { Clause } from "./clauses/base.clause"

export type CompiledSqlQuery = {
    text: string, 
    args: any[],
    argCounter: number
}

export function compileSqlTemplate(strings: TemplateStringsArray, values: any[], argCounter: number): CompiledSqlQuery {
    const templateLength = strings.length
            
    let text = ''
    let args: any[] = []

    strings.forEach((template, index) => {
        text += template
        if (index === templateLength - 1) return

        const value = values[index]

        if (value instanceof Clause) {
            const result = value.map(argCounter)
            argCounter = result.argCounter
            text += result.text
            args.push(...result.args)
        } else {

            if (value === undefined) {
                throw new TypeError(
                    `Query parameter at position ${argCounter} is undefined. 
                    Use null if you want NULL in SQL, or ensure the value is defined.`
                )
            }
            args.push(value)
            text += `$${argCounter}`
            argCounter++
        }
    })
    
    return {text, args, argCounter}
}