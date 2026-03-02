import { Clause,  } from "./base.clause";
import { CompiledSqlQuery, compileSqlTemplate } from "../utils";

export class FragmentClause extends Clause {
    constructor(
        readonly strings: TemplateStringsArray,
        readonly values: any[]
    ) {super()}

    override map(currentArgCounter: number): CompiledSqlQuery {
        return compileSqlTemplate(this.strings, this.values, currentArgCounter)
    }
}

export function fragmentClause(strings: TemplateStringsArray, ...values: any[]) {
    return new FragmentClause(strings, values)
}