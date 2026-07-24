import { Clause,  } from "./abstract.clause";
import { compileSqlTemplate } from "../utils/template-compiler";
import { ClauseStrategyParams, CompiledSqlQuery } from "../types";

export class FragmentClause extends Clause {
    private constructor(
        readonly templates: TemplateStringsArray,
        readonly args: any[]
    ) {super()}

    static create(strings: TemplateStringsArray, ...values: any[]) {
        return new FragmentClause(strings, values)
    }

    override mapIntoQuery(params: ClauseStrategyParams) {
        const compiled = compileSqlTemplate({
            args: this.args, 
            templates: this.templates
        }, params.args.length)

        params.args.push(...compiled.args)
        params.text.push(compiled.text)
    }
}