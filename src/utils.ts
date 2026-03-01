import { Clause } from "./base.clause"

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
                    args.push(value)
                    text += `$${argCounter}`
                    argCounter++
                }
            })        
    
            return {text, args, argCounter}
}