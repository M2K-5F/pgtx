import { RequestType, RequestTypes } from "./constants"


export class ConnectionRequestBuffer {
    private constructor(
        private buffer: Buffer,
        private offset = 0,
        private lastRequestLenByteOffset = 0
    ) {}


    static new(capacity: number) {
        return new ConnectionRequestBuffer(Buffer.allocUnsafe(capacity))
    }

    
    private ensureCapacity(needed: number) {
        const required = needed + this.offset

        if (required <= this.buffer.length) return

        let newCapacity = this.buffer.length * 2
        if (newCapacity < required) {
            newCapacity = required
        }

        const buffer = Buffer.alloc(newCapacity)

        this.buffer.copy(buffer, 0, 0, this.offset)
        this.buffer = buffer

        return this
    }


    writeCString(string: string) {
        this.ensureCapacity(Buffer.byteLength(string) + 1)

        this.offset += this.buffer.write(string, this.offset, 'utf-8')

        this.buffer[this.offset] = 0
        this.offset++

        return this
    }


    writeString(string: string) {
        this.ensureCapacity(Buffer.byteLength(string))

        this.offset += this.buffer.write(string, this.offset, 'utf-8')

        return this
    }


    writeInt32(number: number) {
        this.ensureCapacity(4)

        this.buffer.writeInt32BE(number, this.offset)
        this.offset += 4

        return this
    }


    writeInt16(number: number) {
        this.ensureCapacity(2)

        this.buffer.writeInt16BE(number, this.offset)
        this.offset += 2

        return this
    }


    writeChar(char: string) {
        this.ensureCapacity(1)
        this.buffer[this.offset] = char.charCodeAt(0)
        this.offset++

        return this
    }


    startRequest(requestType: RequestType) {
        this.writeChar(requestType)

        this.lastRequestLenByteOffset = this.offset
        return this.writeInt32(0)
    }


    startMessage() {
        this.lastRequestLenByteOffset = this.offset
        return this.writeInt32(0)
    }


    endRequest() {
        this.buffer.writeInt32BE(
            this.offset - (this.lastRequestLenByteOffset), 
            this.lastRequestLenByteOffset
        )

        return this
    }


    asBuffer() {
        return this.buffer.subarray(0, this.offset)
    }


    clear() {
        this.offset = 0
        this.lastRequestLenByteOffset = 0
    }
}


export class ConnectionRequestWriter {
    private constructor (
        private buffer: ConnectionRequestBuffer
    ) {}

    static new() {
        return new ConnectionRequestWriter(
            ConnectionRequestBuffer.new(65536)
        )
    }

    writeQuery(text: string) {
        this.buffer.startRequest(RequestTypes.SimpleQuery)
            .writeCString(text)
            .endRequest()
            
        return this
    }


    writeParse(name: string | "", text: string) {
        this.buffer.startRequest(RequestTypes.Parse)
            .writeCString(name)
            .writeCString(text)
            .writeInt16(0)
            .endRequest()
            
        return this
    }


    writeDescribe(statementName: string | "") {
        this.buffer.startRequest(RequestTypes.Describe)
            .writeChar('S')
            .writeCString(statementName)
            .endRequest();

        return this
    }


    writeBind(portName: string | "", statementName: string | "", params: (string | null)[]) {

        const request = this.buffer.startRequest(RequestTypes.Bind)
            .writeCString(portName)
            .writeCString(statementName)
            .writeInt16(0)
            .writeInt16(params.length)

        params.forEach(param => {
            request.writeInt32(param ? Buffer.byteLength(param) : -1)
            param && request.writeString(param)
        })

        request.writeInt16(1).writeInt16(1).endRequest()
            
        return this
    }


    writeClose(name: string) {
        this.buffer.startRequest(RequestTypes.Close)
            .writeChar("P")                        
            .writeCString(name)                     
            .endRequest()
        
            return this
    }


    writeStartup(user: string, database: string) {
        this.buffer.startMessage()
            .writeInt32(196608)
            .writeCString('user').writeCString(user)
            .writeCString('database').writeCString(database)
            .writeChar('\0')
            .endRequest()

        return this
    }


    writeExecute(portName: string | "") {
        this.buffer.startRequest(RequestTypes.Execute)
            .writeCString(portName)
            .writeInt32(0)
            .endRequest()

        return this
    }


    writeSync() {
        this.buffer.startRequest(RequestTypes.Sync).endRequest()
            
        return this
    }


    writePassword(password: string) {
        this.buffer.startRequest(RequestTypes.Password)
            .writeCString(password)
            .endRequest()
        
        return this
    }

    
    writeSaslInitial(mechanism: string, clientFirstMessage: string) {
        this.buffer.startRequest(RequestTypes.Password)
            .writeCString(mechanism)
            .writeInt32(Buffer.byteLength(clientFirstMessage, 'utf-8'))
            .writeString(clientFirstMessage)
            .endRequest()

        return this
    }


    writeSaslResponse(clientFinalMessage: string) {
        this.buffer.startRequest(RequestTypes.Password)
            .writeString(clientFinalMessage)
            .endRequest()

        return this
    }


    asBuffer() {
        return this.buffer.asBuffer()
    }


    clear() {
        this.buffer.clear()

        return this
    }
}