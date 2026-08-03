import { createConnection, Socket } from "node:net"
import { ConnectionRequestWriter } from "./connection-request-writer"
import { calculateScramAuth, generateNonce } from "../security/sasl"
import { SocketConnector } from "./socket-connector"
import { AuthenticationCodes, ResponseTypes } from "./constants"
import { encryptMd5 } from "../security/md5"
import { PostgresError } from "../error"
import { Future } from "fluent-future"


export type AuthorizationParams = {
    host: string
    port: number
    user: string
    database: string
    password?: string
}


export const ErrNonceMismatch = new PostgresError("Protocol violation: server nonce doesn't match client nonce")
export const ErrPasswordRequired = new PostgresError('The authorization method requires a password.')



export const createAuthorizedSocket = (writer: ConnectionRequestWriter, params: AuthorizationParams) => {
    return Future.of(
        new Promise<Socket>((resolve, reject) => {
            const nonce = generateNonce()
            let clientMessage = ''
            let serverMessage = ''

            const socket = createConnection({host: params.host, port: params.port})

            const connector = new SocketConnector(socket, 
                (type, length, reader) => {
                    writer.clear()
                    switch (type) {
                        case ResponseTypes.Authentication: {

                            switch (reader.readAuthentication()) {
                                case AuthenticationCodes.Ok: break

                                case AuthenticationCodes.CleartextPassword: {
                                    if (!params.password) throw ErrPasswordRequired
                                    connector.write(writer.writePassword(params.password))
                                    break
                                } 

                                case AuthenticationCodes.MD5Password: {
                                    const salt = reader.readMD5Salt()
                                    if (!params.password) throw ErrPasswordRequired

                                    const password = encryptMd5(params.password, params.user, salt)
                                    connector.write(writer.writePassword(password))
                                    break
                                } 

                                case AuthenticationCodes.SASL: {
                                    reader.readSaslMechanisms()
                                    if (!params.password) throw ErrPasswordRequired

                                    clientMessage = `n=${params.user},r=${nonce}`

                                    connector.write(writer.writeSaslInitial('SCRAM-SHA-256', `n,,${clientMessage}`))
                                    break
                                }

                                case AuthenticationCodes.SASLContinue: {
                                    serverMessage = reader.readSaslMessage(length)

                                    if (!params.password) throw ErrPasswordRequired

                                    const parts = Object.fromEntries(serverMessage.split(',').map(x => x.split('=')))
                                    
                                    const serverNonce = parts.r
                                    const saltBase64 = parts.s
                                    const iterations = parseInt(parts.i, 10)

                                    if (!serverNonce.startsWith(nonce)) {
                                        connector.destroy()
                                        return reject(ErrNonceMismatch)
                                    }

                                    const clientFinalMessageWithoutProof = `c=biws,r=${serverNonce}`
                                    
                                    const authMessage = `${clientMessage},${serverMessage},${clientFinalMessageWithoutProof}`

                                    const { clientProof } = calculateScramAuth(params.password, saltBase64, iterations, authMessage)

                                    const clientFinalMessage = `${clientFinalMessageWithoutProof},p=${clientProof}`

                                    connector.write(writer.writeSaslResponse(clientFinalMessage))
                                    break
                                }

                                case AuthenticationCodes.SASLFinal: {
                                    reader.readSaslMessage(length)
                                    break
                                } 
                            } 
                            break
                        } 


                        case ResponseTypes.ParamaterStatus: {
                            reader.readParameterStatus()
                            break
                        }


                        case ResponseTypes.ErrorResponse: {                            
                            const error = reader.readErrorResponse()
                            connector.destroy()
                            reject(error)
                            return 
                        }


                        case ResponseTypes.BackendKeyData: {
                            reader.readBackendKeyData()
                        }


                        case ResponseTypes.ReadyForQuery: {
                            reader.readReadyForQuery()

                            resolve(connector.unwrapSocket())
                            return
                        }
                    }
                },
                error => {
                    reject(error)
                }
            )

            connector.write(writer.writeStartup(params.user, params.database))
            writer.clear()
        }), 
        error => {
            if (error instanceof PostgresError) return error

            return new PostgresError(error.message)
        }
    )
}