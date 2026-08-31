import { PostgresError } from "./error";
import { ConnectionRequestWriter } from "./protocol/connection-request-writer";
import { PostgresQuery } from "./query";
import { Queue } from "./queue";

export class Batch {
    private _queryQueue: Queue<PostgresQuery>
    private _buffer: ConnectionRequestWriter

    constructor(buffer: ConnectionRequestWriter) {
        this._queryQueue = new Queue()
        this._buffer = buffer
    }


    registerParse(query: PostgresQuery) {
        this._buffer
            .writeParse(query.statement, query.text)
            .writeDescribe(query.statement)
    }


    registerQuery(query: PostgresQuery) {
        this._queryQueue.push(query)

        this._buffer
            .writeBind("", query.statement, query.args)
            .writeExecute("")
            .writeSync()
    }

    get hasMore() {
        return this._queryQueue.hasMore
    }

    end() {
        return this._buffer
    }

    get current() {
        return this._queryQueue.current
    }
    
    next() {
        this._queryQueue.next()
    }

    get shift() {
        return this._queryQueue.shift
    }

    error(cause: PostgresError) {
        while (this._queryQueue.hasMore) {
            this._queryQueue.shift.error(cause)
        }
    }

    get residual() {
        return this._queryQueue.residual
    }
}