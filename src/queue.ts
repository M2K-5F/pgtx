export class Queue<T> {
    private _queue = new Array<T>()
    private _pointer = 0
    
    next() {
        this._queue[this._pointer] = undefined as T
        this._pointer++

        if (this._pointer >= this._queue.length) {
            this._queue.length = 0
            this._pointer = 0
        }
    }

    get current() {        
        return this._queue[this._pointer]
    }
    
    get last() {return this._queue[this._queue.length - 1]}


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

    get residual() {return this._queue.slice(this._pointer)}
}



export class RingQueue<T> {
    private readonly _queue: T[]
    private readonly _mask: number

    private _head = 0
    private _tail = 0
    private _size = 0

    constructor(requestedCapacity = 20000) {
        const capacity = 2 ** Math.ceil(Math.log2(requestedCapacity))

        this._queue = new Array<T>()
        this._mask = capacity - 1
    }

    next() {
        this._queue[this._head] = undefined as T
        this._head = (this._head + 1) & this._mask
        this._size--
    }

    get current() {
        return this._queue[this._head]
    }

    get last() {
        return this._queue[(this._tail - 1) & this._mask]
    }

    get shift() {
        const item = this.current
        this.next()
        return item
    }

    push(item: T) {
        this._queue[this._tail] = item
        this._tail = (this._tail + 1) & this._mask
        this._size++
    }

    get size() {
        return this._size
    }

    get hasMore() {
        return this._size !== 0
    }

    get isFree() {
        return this._size === 0
    }

    get isFull() {
        return this._size === this._mask + 1
    }
}