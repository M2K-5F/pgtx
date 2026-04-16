import { ClauseStrategyParams } from "../types";
import { Clause } from "./abstract.clause";


export class EmptyClause extends Clause {
    static new() {
        return new EmptyClause()
    }

    mapIntoQuery(params: ClauseStrategyParams) {}
}

export const emptyClause = EmptyClause.new()