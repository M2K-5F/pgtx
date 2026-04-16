import { Clause,  } from "./abstract.clause";
import { compileSqlTemplate } from "../utils";
import { ClauseStrategyParams, CompiledSqlQuery } from "../types";

export class FragmentClause extends Clause {
    constructor(
        readonly templates: TemplateStringsArray,
        readonly args: any[]
    ) {super()}

    static create(strings: TemplateStringsArray, ...values: any[]) {
        return new FragmentClause(strings, values)
    }

    override mapIntoQuery(params: ClauseStrategyParams) {
        const compiled = compileSqlTemplate({
            args: this.args, 
            counter: params.counter, 
            templates: this.templates
        })

        params.counter = compiled.counter
        params.args.push(...compiled.args)
        params.text.push(compiled.text)
    }
}