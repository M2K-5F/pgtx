import { Clause, SQLWithArgs } from "./base.clause";

export class FieldsClause extends Clause {
    constructor(
        readonly fields: string[]
    ) {super()}

    override map(currentArgCounter: number): SQLWithArgs {
        return {template: this.fields.join(", "), args: [], counter: currentArgCounter}
    }
}


export function fieldsClause(object: Record<string, string>): FieldsClause {
    return new FieldsClause(Object.keys(object))
}