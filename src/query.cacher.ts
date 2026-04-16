import { Clause } from "./clauses/abstract.clause";
import { CompiledSqlQuery, CompileSQLParams } from "./types";
import { compileSqlTemplate } from "./utils";


export class QueryCacher {
    private readonly cache = new WeakMap<TemplateStringsArray, {text: string, isStatic: boolean}>()

    public cachedBuild(params: CompileSQLParams): CompiledSqlQuery {
            const cached = this.cache.get(params.templates)

            if (cached?.isStatic) {                
                return {text: cached.text, args: params.args, counter: params.counter}
            }
            
            const result = compileSqlTemplate(params)
    
            if (!cached) {
                const isStatic = !params.args.some(value => value instanceof Clause)
                this.cache.set(params.templates, {text: result.text, isStatic})
            }
            
            return result
        }
}