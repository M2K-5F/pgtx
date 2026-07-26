import { QueryText, StatementName } from "./connection";
import { ColumnDescription, ValueOF } from "./types";


export const QueryState = {
    Parsing: 0,
    Describing: 1,
    Executing: 2,
    Completed: 3,
    Failed: 4
} as const


export type State = ValueOF<typeof QueryState>


export class Query<T> {
    promise: Promise<T[]>
    resolve!: (value: T[]) => void
    reject!: (error: Error) => void
    rows: (string | null)[][] = []

    constructor(
        public text: QueryText,
        public args: (string | null)[],
        public state: State,
        public statementName: StatementName,
        public columns?: ColumnDescription[]
    )  {
        this.promise = new Promise<T[]>((a, b) => {
            this.resolve = a
            this.reject = b
        })
    }

    setState(state: State) {
        this.state = state
    }
}