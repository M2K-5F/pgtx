import { Future } from "fluent-future";
import { ColumnDescription, QueryMeta, QueryText, Row, StatementName } from "./types";
import { ErrQueryTimeout, PostgresError } from "./error";


export abstract class Query {
    protected _timer?: NodeJS.Timeout
    
    constructor(
        public statement: StatementName,
        public text: QueryText,
        public args: (string | null)[],
        timeout: number
    ) {
        this._timer = setTimeout(() => {
            this.reject(ErrQueryTimeout)
        }, timeout)
    }


    abstract reject(cause: PostgresError): void

    abstract resolve(...args: any[]): void

    abstract push(...args: any[]): void
}


export class CollectQuery<T extends Row> extends Query {
    public future: Future<T[], PostgresError>
    private _resolve!: (value: T[]) => void
    private _reject!: (error: PostgresError) => void
    private _rows: T[] = []

    constructor(
        statement: StatementName,
        text: QueryText,
        args: (string | null)[],
        public columns: ColumnDescription[] | null,
        timeout: number
    )  {
        super(statement, text, args, timeout)

        const {future, reject, resolve} = Future.withResolvers<T[], PostgresError>()
        this.future = future
        this._resolve = resolve
        this._reject = reject
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


export class ExecuteQuery extends Query {
    public future: Future<void, PostgresError>
    private _resolve!: () => void
    private _reject!: (error: PostgresError) => void
    constructor(
        statement: StatementName,
        text: QueryText,
        args: (string | null)[],
        public columns: ColumnDescription[] | null,
        timeout: number
    ) {
        super(statement, text, args, timeout)

        const {future, reject, resolve} = Future.withResolvers<void, PostgresError>()

        this.future = future; this._reject = reject; this._resolve = resolve
    }

    reject(cause: PostgresError) {
        clearTimeout(this._timer)
        this._reject(cause)
    }


    resolve() {
        clearTimeout(this._timer)
        this._resolve()
    }

    push(): void {}
}


export class StreamQuery<T> extends Query {
    constructor(
        statement: StatementName,
        text: QueryText,
        args: (string | null)[],
        public controller: ReadableStreamDefaultController<T>,
        public columns: ColumnDescription[] | null,
        timeout: number
    ) {
        super(statement, text, args, timeout)
    }


    push(value: T) {
        this.controller.enqueue(value)
    }


    reject(cause: PostgresError) {
        clearTimeout(this._timer)
        this.controller.error(cause)
    }


    resolve() {
        clearTimeout(this._timer)
        this.controller.close()
    }
}

export type PostgresQuery = CollectQuery<any> | StreamQuery<any> | ExecuteQuery