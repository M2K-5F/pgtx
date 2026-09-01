import { Socket } from 'net'
import { ResponseType } from './constants'
import { ConnectionResponseBuffer } from './connection-response-reader'
import { ConnectionRequestBuffer } from './connection-request-writer'

export class SocketConnector {
    private residualBuffer: Buffer | null = null
    private _onError: (error: unknown) => void
    private _onClose: () => void
    private _onData: (buffer: Buffer) => void
    private _destroyed = false

    constructor(
        private _socket: Socket,
        onData: (type: ResponseType, length: number, reader: ConnectionResponseBuffer) => void,
        onError: (error: unknown) => void
    ) {
        this._onError = (err) => {
            if (this._destroyed) return
            this._destroyed = true
            onError(err)
            this.destroy()
        }

        this._onClose = () => {
            if (this._destroyed) return
            this._destroyed = true
            onError(new Error("Socket closed"))
            this.destroy()
        }

        this._onData = buffer => {
            const currentBuffer = this.residualBuffer 
                ? Buffer.concat([this.residualBuffer, buffer as Buffer]) 
                : buffer as Buffer
                
            this.residualBuffer = null

            const reader = ConnectionResponseBuffer.from(currentBuffer) 

            while (reader.hasMore()) {
                if (!reader.hasFullPacket()) {
                    this.residualBuffer = reader.getResidualBuffer()
                    return
                }

                const {type, length} = reader.readType()
                onData(type, length, reader)
            }
        }

        _socket.setKeepAlive(true, 10000)
        _socket.on('data', this._onData)
        _socket.on('error', this._onError)
        _socket.on('close', this._onClose)

    }


    write(writer: ConnectionRequestBuffer) {
        this._socket.write(writer.asBuffer())
    }


    unwrapSocket() {
        this._socket.off('error', this._onError)
        this._socket.off("data", this._onData)
        this._socket.off('close', this._onClose)

        return this._socket
    }


    destroy() {
        this._socket.destroy()
    }
}
