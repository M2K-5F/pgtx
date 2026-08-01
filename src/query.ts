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
    private _resolve!: (value: T[]) => void
    private _reject!: (error: Error) => void
    private _rows: T[] = []

    constructor(
        public text: QueryText,
        public args: (string | null)[],
        public state: State,
        public statementName: StatementName,
        public columns?: ColumnDescription[]
    )  {
        this.promise = new Promise<T[]>((a, b) => {
            this._resolve = a
            this._reject = b
        })
    }


    setState(state: State) {
        this.state = state
    }


    push(value: T) {
        this._rows.push(value)
    }

    
    reject(cause: Error) {
        this._reject(cause)
    }


    resolve() {
        this._resolve(this._rows)
    }
}