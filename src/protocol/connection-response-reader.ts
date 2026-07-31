import { AuthenticationCode, DataTypeOid, DataTypeOids, ResponseType, TransactionStatus } from "./constants"
import { ColumnDescription } from "../types"
import { PostgresError } from "../error"
import { ChannelName } from "../connection"


const columnValueCache = new Map<number, Map<string, string>>()
const POSTGRES_EPOCH_MS = 946684800000

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


    readRawBinaryString(length: number): string {
        const text = this.buffer.toString('latin1', this.caret, this.caret + length)
        this.caret += length
        return text
    }


    readBinaryDate(): Date {
        const daysSince2000 = this.readInt32()
        const ms = POSTGRES_EPOCH_MS + (daysSince2000 * 86400000)
        return new Date(ms)
    }


    readBinaryTimestamp(): Date {
        const microSecondsSince2000 = this.readInt64()
        const msSince2000 = Number(microSecondsSince2000 / 1000n)
        return new Date(POSTGRES_EPOCH_MS + msSince2000)
    }


    readBinaryTime(): string {
        const microSecondsSinceMidnight = this.readInt64()
        const totalMs = Number(microSecondsSinceMidnight / 1000n)
        
        const seconds = Math.floor(totalMs / 1000)
        const ms = totalMs % 1000
        const minutes = Math.floor(seconds / 60)
        const hours = Math.floor(minutes / 60)

        return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
    }


    skipBytes(byteCount: number) {
        this.caret += byteCount
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

    readBool() {
        const value = this.buffer[this.caret] !== 0
        this.caret++
        return value
    }

    readInt64(): bigint {
        const value = this.buffer.readBigInt64BE(this.caret)
        this.caret += 8
        return value
    }

    readFloat64(): number {
        const value = this.buffer.readDoubleBE(this.caret)
        this.caret += 8
        return value
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
        this.buffer.skipBytes(4)
        const columnsCount = this.buffer.readInt16()
        const columns = new Array<ColumnDescription>(columnsCount)

        for (let i = 0; i < columnsCount; i++) {
            const name = this.buffer.readCString()
            this.buffer.readInt32()
            this.buffer.readInt16()

            columns[i] = {
                name: name,
                typeOID: this.buffer.readInt32() as DataTypeOid,
            }
            
            this.buffer.readInt32()
            this.buffer.readInt32()
        }

        return columns
    }


    readDataRow(descriptions: ColumnDescription[], int8toBigint: boolean = false): any[] {
        this.buffer.skipBytes(4)
        const fieldsCount = this.buffer.readInt16()
        const rowValues: any[] = []

        for (let i = 0; i < fieldsCount; i++) {
            let fieldLength = this.buffer.readInt32()

            if (fieldLength === -1) {
                rowValues.push(null)
                continue
            }

            const desc = descriptions[i]
            const oid = desc ? desc.typeOID : 0

            switch (oid) {
                case DataTypeOids.Jsonb: { 
                    this.buffer.skipBytes(1)
                    const jsonText = this.buffer.readRawString(fieldLength - 1)
                    rowValues.push(JSON.parse(jsonText))
                } break

                case DataTypeOids.Json: {
                    const jsonText = this.buffer.readRawString(fieldLength)
                    rowValues.push(JSON.parse(jsonText))
                } break

                case DataTypeOids.Int4: {
                    rowValues.push(this.buffer.readInt32())
                } break

                case DataTypeOids.Int2: {
                    rowValues.push(this.buffer.readInt16())
                } break

                case DataTypeOids.Bool: {
                    rowValues.push(this.buffer.readBool())
                } break

                case DataTypeOids.Int8: {
                    const bigint = this.buffer.readInt64()
                    rowValues.push(int8toBigint ? bigint : Number(bigint))
                } break

                case DataTypeOids.Float8: {
                    rowValues.push(this.buffer.readFloat64())
                } break

                case DataTypeOids.Date: {
                    rowValues.push(this.buffer.readBinaryDate())
                } break

                case DataTypeOids.Timestamp:   
                case DataTypeOids.Timestamptz: {
                    rowValues.push(this.buffer.readBinaryTimestamp())
                } break

                case DataTypeOids.Time: {
                    rowValues.push(this.buffer.readBinaryTime())
                } break

                case DataTypeOids.Timetz: {
                    const timeStr = this.buffer.readBinaryTime()
                    this.buffer.skipBytes(4)
                    rowValues.push(timeStr)
                } break

                case DataTypeOids.Text:
                case DataTypeOids.Varchar:
                case DataTypeOids.Uuid: {
                    if (fieldLength <= 32) {
                        let cacheForColumn = columnValueCache.get(i)
                        if (!cacheForColumn) {
                            cacheForColumn = new Map<string, string>()
                            columnValueCache.set(i, cacheForColumn)
                        }

                        const byteKey = this.buffer.readRawBinaryString(fieldLength)
                        let cachedString = cacheForColumn.get(byteKey)

                        if (cachedString === undefined) {
                            cachedString = Buffer.from(byteKey, 'binary').toString('utf-8')
                            if (cacheForColumn.size < 512) {
                                cacheForColumn.set(byteKey, cachedString)
                            }
                        }
                        rowValues.push(cachedString)
                    } else {
                        rowValues.push(this.buffer.readRawString(fieldLength))
                    }
                } break

                default: {
                    this.buffer.skipBytes(fieldLength)
                    rowValues.push(undefined)
                } break
            }
        }

        return rowValues
    }


    readNotificationResponse() {
        this.buffer.readInt32()
        this.buffer.readInt32()
        const name = this.buffer.readCString() as ChannelName
        const payload = this.buffer.readCString()
        
        return {name, payload} 
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