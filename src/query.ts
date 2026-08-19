import { Future } from "fluent-future";
import { ColumnDescription, QueryMeta, QueryText, StatementName } from "./types";
import { ErrQueryTimeout, PostgresError } from "./error";


export abstract class Query {
    protected _timer?: NodeJS.Timeout
    
    constructor(
        public statement: StatementName,
        timeout: number
    ) {
        this._timer = setTimeout(() => {
            this.reject(ErrQueryTimeout)
        }, timeout)
    }


    abstract reject(cause: PostgresError): void

    abstract resolve(...args: any[]): void
}


export class SimpleQuery<T> extends Query {
    public future: Future<T[], PostgresError>
    private _resolve!: (value: T[]) => void
    private _reject!: (error: PostgresError) => void
    private _rows: T[] = []

    constructor(
        statement: StatementName,
        public text: QueryText,
        public args: (string | null)[],
        public columns: ColumnDescription[],
        timeout: number
    )  {
        super(statement, timeout)

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


export class ParseQuery extends Query {
    public future: Future<QueryMeta,  PostgresError>
    private _resolve!: (columns: QueryMeta) => void
    private _reject!: (error: PostgresError) => void

    constructor(
        statement: StatementName,
        public text: QueryText,
        timeout: number
    )  {
        super(statement, timeout)

        const {future, reject, resolve} = Future.withResolvers<QueryMeta, PostgresError>()
        this.future = future
        this._resolve = resolve
        this._reject = reject
    }    


    reject(cause: PostgresError) {
        clearTimeout(this._timer)
        this._reject(cause)
    }


    resolve(meta: QueryMeta) {
        clearTimeout(this._timer)
        this._resolve(meta)
    }
}


export class StreamQuery<T> extends Query {
    constructor(
        statement: StatementName,
        public text: QueryText,
        public args: (string | null)[],
        public controller: ReadableStreamDefaultController<T>,
        public columns: ColumnDescription[],
        timeout: number
    ) {
        super(statement, timeout)
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

export type PostgresQuery = SimpleQuery<any> | ParseQuery | StreamQuery<any>