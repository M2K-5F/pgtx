export class Queue<T> {
    private _queue = new Array<T>()
    private _pointer = 0
    
    next() {
        this._pointer++
        if (this._pointer === this._queue.length) {
            this._queue = []
            this._pointer = 0
        }
    }

    get() {        
        return this._queue[this._pointer]
    }

    push(item: T) {
        this._queue.push(item)
    }

    get size() {
        return this._queue.length - this._pointer
    }

    get isFree() {return this._pointer === this._queue.length}
}