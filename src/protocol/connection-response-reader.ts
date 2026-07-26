import { AuthenticationCode, ResponseType, TransactionStatus } from "./constants"
import { ColumnDescription } from "../types"
import { PostgresError } from "../error"


export class ConnectionResponseBuffer {
    private caret = 0

    private constructor(
        private buffer: Buffer
    ) {}

    
    static from(buffer: Buffer) {
        return new ConnectionResponseBuffer(buffer)
    }


    readChar(): string {
        const char = String.fromCharCode(this.buffer[this.caret])
        this.caret += 1
        return char
    }


    readInt32(): number {
        const value = this.buffer.readInt32BE(this.caret)
        this.caret += 4
        return value
    }

    
    readInt16(): number {
        const value = this.buffer.readInt16BE(this.caret)
        this.caret += 2
        return value
    }


    readCString(): string {
        const end = this.buffer.indexOf(0, this.caret)
        const text = this.buffer.toString('utf-8', this.caret, end)
        this.caret = end + 1
        return text
    }

    
    readRawString(length: number): string {
        const text = this.buffer.toString('utf-8', this.caret, this.caret + length)
        this.caret += length
        return text
    }


    readBytes(length: number): Buffer {
        const slice = this.buffer.subarray(this.caret, this.caret + length);
        this.caret += length;
        return slice;
    }


    hasMore(): boolean {
        return this.caret < this.buffer.length
    }


    hasFullPacket(): boolean {
        const availableBytes = this.buffer.length - this.caret

        if (availableBytes < 5) return false

        const packetLength = this.buffer.readInt32BE(this.caret + 1)

        if (availableBytes < 1 + packetLength) return false

        return true
    }

    
    getResidualBuffer() {
        return this.buffer.subarray(this.caret)
    }
}


export class ConnectionResponseReader {
    private currentPacketLength = 0; 

    private constructor(
        private buffer: ConnectionResponseBuffer
    ) {}


    static from(buffer: Buffer) {
        return new ConnectionResponseReader(ConnectionResponseBuffer.from(buffer))
    }


    readType() {
        return this.buffer.readChar() as ResponseType
    }


    readAuthentication() {
        this.currentPacketLength = this.buffer.readInt32()

        return this.buffer.readInt32() as AuthenticationCode
    }

    
    readMD5Salt() {
        return this.buffer.readBytes(4)
    }


    readParameterStatus() {
        this.buffer.readInt32()

        return {
            name: this.buffer.readCString(), 
            value: this.buffer.readCString()
        }
    }


    readBackendKeyData() {
        this.buffer.readInt32()

        return {
            PID: this.buffer.readInt32(), 
            secret: this.buffer.readInt32()
        }
    }


    readErrorResponse(): PostgresError {
        this.buffer.readInt32()
            
        let severity = ''
        let code = ''
        let message = ''
        let detail = ''
        let where = ''
        let hint = ''
        let position = ''
        let dataType = ''
        let constraint = ''

        while (true) {
            const marker = this.buffer.readChar()
            if (marker === '\0') break

            const text = this.buffer.readCString()

            switch (marker) {
                case 'S': severity = text; break;
                case 'C': code = text; break;
                case 'M': message = text; break;
                case 'D': detail = text; break;
                case 'W': where = text; break;
                case 'H': hint = text; break;        
                case 'P': position = text; break;    
                case 'd': dataType = text; break;    
                case 'n': constraint = text; break;  
            }
        }

        return new PostgresError(
            message, 
            code, 
            detail, 
            severity, 
            where, 
            hint, 
            position, 
            dataType, 
            constraint
        )
    }


    readReadyForQuery() {
        this.buffer.readInt32()
        return this.buffer.readChar() as TransactionStatus
    }


    readSaslMechanisms(): string[] {
        const mechanisms: string[] = []

        while (true) {
            const mech = this.buffer.readCString()
            if (mech === "") break
            mechanisms.push(mech)
        }

        return mechanisms
    }


    readSaslMessage(): string {
        const dataLength = this.currentPacketLength - 4 - 4
        
        return this.buffer.readRawString(dataLength)
    }


    readRowDescription() {
        this.buffer.readInt32()
        const columnsCount = this.buffer.readInt16()
        const columns = new Array<ColumnDescription>(columnsCount)

        for (let i = 0; i < columnsCount; i++) {
            const name = this.buffer.readCString()
            this.buffer.readInt32()
            this.buffer.readInt16()

            columns[i] = {
                name: name,
                typeOID: this.buffer.readInt32(),
            }
            
            this.buffer.readInt32()
            this.buffer.readInt32()
        }

        return columns
    }


    readDataRow() {
        this.buffer.readInt32()
        const fieldsCount = this.buffer.readInt16()
        const rowValues: (string | null)[] = [];

        for (let i = 0; i < fieldsCount; i++) {
            const fieldLength = this.buffer.readInt32()

            if (fieldLength === -1) {
                rowValues.push(null)
            } else {
                rowValues.push(this.buffer.readRawString(fieldLength))
            }
        }

        return rowValues
    }


    readCommandComplete(): string {
        this.buffer.readInt32()
        return this.buffer.readCString()
    }


    hasMore() {
        return this.buffer.hasMore()
    }


    hasFullPacket() {
        return this.buffer.hasFullPacket()
    }

    
    getResidualBuffer() {
        return this.buffer.getResidualBuffer()
    }


    readParseComplete() {
        this.buffer.readInt32()
    }


    readBindComplete() {
        this.buffer.readInt32()
    }


    readParameterDescription() {
        this.buffer.readInt32()
        const count = this.buffer.readInt16()
        for (let i = 0; i < count; i++) {
            this.buffer.readInt32()
        }
    }

    readNoData() {
        this.buffer.readInt32()
    }
}