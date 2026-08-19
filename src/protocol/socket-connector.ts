import { Socket } from 'net'
import { ResponseType } from './constants'
import { ConnectionResponseReader } from '../protocol/connection-response-reader'
import { ConnectionRequestWriter } from '../protocol/connection-request-writer'

export class SocketConnector {
    private residualBuffer: Buffer | null = null
    private _isDestroyed = false

    constructor(
        private _socket: Socket,
        private _onData: (type: ResponseType, length: number, reader: ConnectionResponseReader) => void,
        private _onError: (error: Error) => void
    ) {
        _socket.setKeepAlive(true, 10000)
        _socket.on('data', buffer => {
            const currentBuffer = this.residualBuffer 
                ? Buffer.concat([this.residualBuffer, buffer as Buffer]) 
                : buffer as Buffer
                
            this.residualBuffer = null

            const reader = ConnectionResponseReader.from(currentBuffer) 

            while (reader.hasMore()) {
                if (!reader.hasFullPacket()) {
                    this.residualBuffer = reader.getResidualBuffer()
                    return
                }

                const {type, length} = reader.readType()
                this._onData(type, length, reader)
            }
        })
        _socket.on('error', error => {
            this._onError(error)
            this._socket.destroy()
            this._isDestroyed = true
        })
    }


    write(writer: ConnectionRequestWriter) {

        this._socket.write(writer.asBuffer())
    }


    unwrapSocket() {
        this._socket.off('error', this._onError)
        this._socket.off("data", this._onData)

        return this._socket
    }


    destroy() {
        this._isDestroyed = true
        this._socket.destroy()
    }


    get isDestroyed() {return this._isDestroyed}
}
