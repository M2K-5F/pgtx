import { Clause } from "./base.clause"
import { QueryBuild } from "./types"

export class QueryBuilder {
    private cache: WeakMap<TemplateStringsArray, {text: string, isStatic: boolean}>

    constructor() {
        this.cache = new WeakMap()
    }

    public build(strings: TemplateStringsArray, values: any[]): QueryBuild {
        const templateLength = strings.length
        let argumentCounter = 1
        
        let text = ''
        let args: any[] = []

        strings.forEach((template, index) => {
            text += template
            if (index === templateLength - 1) return

            const value = values[index]

            if (value instanceof Clause) {
                const result = value.map(argumentCounter)
                argumentCounter = result.counter
                text += result.template
                args.push(...result.args)
            } else {
                args.push(value)
                text += `$${argumentCounter}`
                argumentCounter++
            }
        })        

        return {text, args}
    }

    public cachedBuild(strings: TemplateStringsArray, values: any[]): QueryBuild {
        const cached = this.cache.get(strings)
        if (cached?.isStatic) {
            return {text: cached.text, args: values}
        }

        const result = this.build(strings, values)

        if (!cached) {
            const isStatic = !values.some(value => value instanceof Clause)
            this.cache.set(strings, {text: result.text, isStatic})
        }
        
        return result
    }
}