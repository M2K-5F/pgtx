import { Future } from "fluent-future";
import { QueryText, StatementName } from "./connection";
import { ColumnDescription, ValueOF } from "./types";
import { PostgresError } from "./error";


export const QueryState = {
    Parsing: 0,
    Executing: 1,
    Completed: 2,
    Failed: 3
} as const


export type State = ValueOF<typeof QueryState>


export class Query<T> extends Future<T[], PostgresError> {
    static get [Symbol.species]() {
        return Promise
    }

    private _timer?: NodeJS.Timeout
    private _rows: T[] = []
    private _res!: (value: T[]) => void
    private _rej!: (error: PostgresError) => void

    constructor(
        public text: QueryText,
        public args: (string | null)[],
        public state: State,
        public statementName: StatementName,
        public columns?: ColumnDescription[]
    ) {
        let resolve, reject

        super((res, rej) => {
            resolve = res; reject = rej
        })

        this._rej = reject!; this._res = resolve!
    }

    startTimeout(timeout: number) {
        this._timer = setTimeout(() => {
            this._rej(new PostgresError('Query timeout', '57014'))
        }, timeout)
    }

    setState(state: State) {
        this.state = state
    }


    push(value: T) {
        this._rows.push(value)
    }
private _isSettled = false; // 🛡️ Защита от повторного/ложного вызова

    // ... твой конструктор ...

    reject(cause: PostgresError) {
        if (this._isSettled) {
            console.log(`[Query ] 🚨 ЛОЖНЫЙ/ПОВТОРНЫЙ REJECT! Запрос уже был завершен.`);
            return;
        }
        this._isSettled = true;
        clearTimeout(this._timer)
        this._rej(cause)
    }

    resolve() {
        if (this._isSettled) {
            console.log(`[Query ] 🚨 ЛОЖНЫЙ/ПОВТОРНЫЙ RESOLVE! Батч пытается закрыть запрос дважды.`);
            return;
        }
        this._isSettled = true;
        clearTimeout(this._timer)
        this._res(this._rows)
    }
}


export class StreamQuery<T> {
    
    private _timer?: NodeJS.Timeout 

    constructor(
        public text: QueryText,
        public args: (string | null)[],
        public state: State,
        public statementName: StatementName,
        private _controller: ReadableStreamDefaultController<T>,
        public columns?: ColumnDescription[]
    ) {}

    setState(state: State) {
        this.state = state
    }

    startTimeout(timeout: number) {
        this._timer = setTimeout(() => {
            this.reject(new PostgresError('Query timeout', '57014'))
        }, timeout)
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
