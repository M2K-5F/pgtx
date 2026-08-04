import { Future } from "fluent-future";
import { QueryText, StatementName } from "./connection";
import { ColumnDescription, ValueOF } from "./types";
import { PostgresError } from "./error";


export const QueryState = {
    Parsing: 0,
    Describing: 1,
    Executing: 2,
    Completed: 3,
    Failed: 4
} as const


export type State = ValueOF<typeof QueryState>


export class Query<T> {
    future: Future<T[], PostgresError>
    private _resolve!: (value: T[]) => void
    private _reject!: (error: PostgresError) => void
    private _rows: T[] = []

    private _timer?: NodeJS.Timeout

    constructor(
        public text: QueryText,
        public args: (string | null)[],
        public state: State,
        public statementName: StatementName,
        timeout: number,
        public columns?: ColumnDescription[]
    )  {
        const {future, reject, resolve} = Future.withResolvers<T[], PostgresError>()
        this.future = future
        this._resolve = resolve
        this._reject = reject

        this._timer = setTimeout(() => reject(new PostgresError('Query timeout', '57014')), timeout)
    }


    setState(state: State) {
        this.state = state
    }


    push(value: T) {
        this._rows.push(value)
    }

    
    reject(cause: PostgresError) {
        clearTimeout(this._timer)
        this._reject(cause)
    }


    resolve() {
        clearTimeout(this._timer)
        this._resolve(this._rows)
    }
}

export class StreamQuery<T> {
    
    
    private _timer?: NodeJS.Timeout 

    constructor(
        public text: QueryText,
        public args: (string | null)[],
        public state: State,
        public statementName: StatementName,
        timeout: number,
        private _controller: ReadableStreamDefaultController<T>,
        public columns?: ColumnDescription[]
    ) {

        this._timer = setTimeout(() => {
            this.reject(new PostgresError('Query timeout', '57014'))
        }, timeout)
    }

    setState(state: State) {
        this.state = state
    }

    push(value: T) {
        this._controller.enqueue(value)
    }

    reject(cause: PostgresError) {
        clearTimeout(this._timer)
        this._controller.error(cause)
    }

    resolve() {
        clearTimeout(this._timer)
        this._controller.close()
    }
}
