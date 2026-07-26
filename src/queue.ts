export class Queue<T> {
    private _queue = new Array<T>()
    private _pointer = 0
    
    next() {
        this._pointer++
        if (this._pointer >= this._queue.length) {
            
            this._queue = []
            this._pointer = 0
        }
    }

    get() {        
        return this._queue[this._pointer]
    }


    shift() {
        const item = this._queue[this._pointer]
        this._pointer++
        if (this._pointer >= this._queue.length) {
            
            this._queue = []
            this._pointer = 0
        }
        return item
    }


    push(item: T) {
        this._queue.push(item)
    }

    get size() {
        return this._queue.length - this._pointer
    }


    get hasMore() {
        return this._pointer < this._queue.length
    }


    get isFree() {return this._pointer >= this._queue.length}
}