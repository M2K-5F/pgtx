import { QueryText, StatementName } from "./connection";
import { PostgresError } from "./error";
import { ConnectionRequestWriter } from "./protocol/connection-request-writer";
import { ParseQuery, PostgresQuery, Query, StreamQuery } from "./query";
import { Queue } from "./queue";

export class Batch {
    private _queryQueue: Queue<PostgresQuery>
    private _buffer: ConnectionRequestWriter

    constructor(buffer: ConnectionRequestWriter) {
        this._queryQueue = new Queue()
        this._buffer = buffer
    }

    registerQuery(query: PostgresQuery, timeout: number) {
        this._queryQueue.push(query)
        query.startTimeout(timeout)

        if (query instanceof ParseQuery) {
            this._buffer
                .writeParse(query.statement, query.text)
                .writeDescribe(query.statement)
            return
        }

        this._buffer
            .writeBind("", query.statement, query.args)
            .writeExecute("")
    }

    end() {
        return this._buffer.writeSync()
    }

    get current() {
        return this._queryQueue.current
    }
    
    next() {
        this._queryQueue.next()
    }

    reject(cause: PostgresError) {
        while (this._queryQueue.hasMore) {
            this._queryQueue.shift.reject(cause)
        }
    }
}