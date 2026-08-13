import { PostgresError } from "./error"

export class Queue<T> {
    private _queue: T[]
    private _mask: number
    
    private _head = 0
    private _tail = 0

    constructor(requestedCapacity: number = 32768) {
        const capacity = Math.pow(2, Math.ceil(Math.log2(requestedCapacity)))
        
        this._queue = new Array<T>(capacity)
        this._mask = capacity - 1
    }

    next() {
        this._queue[this._head] = undefined as T
        
        this._head = (this._head + 1) & this._mask
    }

    get current() {
        return this._queue[this._head]
    }
    
    get last(){
        return this._queue[(this._tail - 1) & this._mask]
    }

    get shift(){
        const item = this._queue[this._head]
        this.next()
        
        return item
    }

    /** returns true if queue overflowed else false */
    push(item: T) {
        this._queue[this._tail] = item
        this._tail = (this._tail + 1) & this._mask

        return this._tail === this._head
    }

    get size() {
        return (this._tail - this._head) & this._mask
    }

    get hasMore() {
        return this._head !== this._tail
    }

    get isFree() {
        return this._head === this._tail
    }
}