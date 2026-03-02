import { Clause } from "./clauses/base.clause";
import { CompiledSqlQuery, compileSqlTemplate } from "./utils";


export class QueryCacher {
    private readonly cache = new WeakMap<TemplateStringsArray, {text: string, isStatic: boolean}>()

    public cachedBuild(strings: TemplateStringsArray, values: any[], argCounter: number): CompiledSqlQuery {
            const cached = this.cache.get(strings)
            if (cached?.isStatic) {
                return {text: cached.text, args: values, argCounter}
            }
    
            const result = compileSqlTemplate(strings, values, 1)
    
            if (!cached) {
                const isStatic = !values.some(value => value instanceof Clause)
                this.cache.set(strings, {text: result.text, isStatic})
            }
            
            return result
        }
}