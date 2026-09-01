import { Future, Resolvers } from "fluent-future";
import { ColumnDescription, QueryText, Row, StatementName } from "./types";
import { ErrQueryTimeout, PostgresError } from "./error";


export abstract class Query {
    protected _timer?: NodeJS.Timeout
    
    constructor(
        public statement: StatementName,
        public text: QueryText,
        public args: unknown[],
        timeout: number
    ) {
        this._timer = setTimeout(() => {
            this.error(ErrQueryTimeout)
        }, timeout)
    }


    abstract error(cause: PostgresError): void

    abstract complete(...args: any[]): void
}


export class CollectQuery<T extends Row> extends Query {
    private _rows: T[] = []

    constructor(
        statement: StatementName,
        text: QueryText,
        args: unknown[],
        public columns: ColumnDescription[] | null,
        timeout: number,
        public resolvers: Resolvers<Future<T[], PostgresError>>
    )  {
        super(statement, text, args, timeout)
    }    


    push(value: T) {
        this._rows.push(value)
    }

    
    error(cause: PostgresError) {
        clearTimeout(this._timer)
        this.resolvers.reject(cause)
    }


    complete() {
        clearTimeout(this._timer)
        this.resolvers.resolve(this._rows)
    }
}


export class ExecuteQuery extends Query {
    constructor(
        statement: StatementName,
        text: QueryText,
        args: unknown[],
        timeout: number,
        public resolvers: Resolvers<Future<void, PostgresError>>
    ) {
        super(statement, text, args, timeout)
    }

    error(cause: PostgresError) {
        clearTimeout(this._timer)
        this.resolvers.reject(cause)
    }


    complete() {
        clearTimeout(this._timer)
        this.resolvers.resolve()
    }
}


export class StreamQuery<T> extends Query {
    constructor(
        statement: StatementName,
        text: QueryText,
        args: unknown[],
        public controller: ReadableStreamDefaultController<T>,
        public columns: ColumnDescription[] | null,
        timeout: number
    ) {
        super(statement, text, args, timeout)
    }


    push(value: T) {
        try {
            this.controller.enqueue(value)
        } catch {}
    }


    error(cause: PostgresError) {
        clearTimeout(this._timer)
        this.controller.error(cause)
    }


    complete() {
        clearTimeout(this._timer)
        try {
            this.controller.close()
        } catch {}
    }
}

export type PostgresQuery = CollectQuery<any> | StreamQuery<any> | ExecuteQuery