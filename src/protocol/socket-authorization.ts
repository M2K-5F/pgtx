import { createConnection, Socket } from "node:net"
import { ConnectionRequestWriter } from "./connection-request-writer"
import { calculateScramAuth, generateNonce } from "../security/sasl"
import { SocketConnector } from "./socket-connector"
import { AuthenticationCodes, ResponseTypes } from "./constants"
import { encryptMd5 } from "../security/md5"


export type AuthorizationParams = {
    host: string
    port: number
    user: string
    database: string
    password?: string
}


export const createAuthorizedSocket = (writer: ConnectionRequestWriter, params: AuthorizationParams) => {
    return new Promise<Socket>((resolve, reject) => {
        const nonce = generateNonce()
        let clientMessage = ''
        let serverMessage = ''

        const socket = createConnection({host: params.host, port: params.port})

        const connector = new SocketConnector(socket, 
            (type, reader) => {
                writer.clear()
                switch (type) {
                    case ResponseTypes.Authentication: {
                        switch (reader.readAuthentication()) {
                            case AuthenticationCodes.Ok: break

                            case AuthenticationCodes.CleartextPassword: {
                                if (!params.password) throw new Error('The authorization method requires a password.')
                                connector.write(writer.writePassword(params.password))
                                break
                            } 

                            case AuthenticationCodes.MD5Password: {
                                const salt = reader.readMD5Salt()
                                if (!params.password) throw new Error('The authorization method requires a password.')

                                const password = encryptMd5(params.password, params.user, salt)
                                connector.write(writer.writePassword(password))
                                break
                            } 

                            case AuthenticationCodes.SASL: {
                                reader.readSaslMechanisms()
                                if (!params.password) throw new Error('The authorization method requires a password.')

                                clientMessage = `n=${params.user},r=${nonce}`

                                connector.write(writer.writeSaslInitial('SCRAM-SHA-256', `n,,${clientMessage}`))
                                break
                            }

                            case AuthenticationCodes.SASLContinue: {
                                serverMessage = reader.readSaslMessage()

                                if (!params.password) throw new Error('The authorization method requires a password.')

                                const parts = Object.fromEntries(serverMessage.split(',').map(x => x.split('=')))
                                
                                const serverNonce = parts.r
                                const saltBase64 = parts.s
                                const iterations = parseInt(parts.i, 10)

                                if (!serverNonce.startsWith(nonce)) {
                                    connector.destroy()
                                    return reject("Protocol violation: server nonce doesn't match client nonce")
                                }

                                const clientFinalMessageWithoutProof = `c=biws,r=${serverNonce}`
                                
                                const authMessage = `${clientMessage},${serverMessage},${clientFinalMessageWithoutProof}`

                                const { clientProof } = calculateScramAuth(params.password, saltBase64, iterations, authMessage)

                                const clientFinalMessage = `${clientFinalMessageWithoutProof},p=${clientProof}`

                                connector.write(writer.writeSaslResponse(clientFinalMessage))
                                break
                            }

                            case AuthenticationCodes.SASLFinal: {
                                reader.readSaslMessage()
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
                        const message = reader.readErrorResponse()
                        connector.destroy()
                        reject(message)
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
    })
}