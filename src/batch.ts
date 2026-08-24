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
        let counter = 0
        while (this._queryQueue.hasMore) {
            counter++
            this._queryQueue.shift.reject(cause)
        }

        return counter
    }
}