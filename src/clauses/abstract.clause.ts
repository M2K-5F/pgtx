import { ClauseStrategyParams } from "../types";

export abstract class Clause {
    abstract mapIntoQuery(params: ClauseStrategyParams): void
}