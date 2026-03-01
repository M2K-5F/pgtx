import { Clause } from "./base.clause";
import { CompiledSqlQuery } from "./utils";

export class FieldsClause extends Clause {
    constructor(
        readonly fields: string[]
    ) {super()}

    override map(argCounter: number): CompiledSqlQuery {
        const text = this.fields.join(", ")
        const args: any[] = []

        return {text, args, argCounter}
    }
}


export function fieldsClause(object: Record<string, string>): FieldsClause {
    return new FieldsClause(Object.keys(object))
}