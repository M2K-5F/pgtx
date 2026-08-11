export class Queue<T> {
    private _queue = new Array<T>()
    private _pointer = 0
    
    next() {
        this._queue[this._pointer] = null as T
        this._pointer++
        
        if (this._pointer >= this._queue.length) {
            this._queue.length = 0
            this._pointer = 0
        }
    }

    get current() {        
        return this._queue[this._pointer]
    }
    
    get last() {return  this._queue[this._queue.length -1]}


    get shift() {
        const item = this._queue[this._pointer]
        this.next()
        
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