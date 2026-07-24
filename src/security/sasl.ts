import { randomBytes, createHmac, pbkdf2Sync, createHash } from 'crypto';


export function generateNonce(): string {
    return randomBytes(18).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 24)
}


function hmac(key: Buffer | string, data: string | Buffer): Buffer {
    return createHmac('sha256', key).update(data).digest()
}


function hi(password: string, salt: Buffer, iterations: number): Buffer {
    return pbkdf2Sync(password, salt, iterations, 32, 'sha256')
}


export function calculateScramAuth(
    password: string,
    saltBase64: string,
    iterations: number,
    authMessage: string
): { clientProof: string, serverSignature: string } {
    const salt = Buffer.from(saltBase64, 'base64')

    const saltedPassword = hi(password, salt, iterations)

    const clientKey = hmac(saltedPassword, 'Client Key')

    const storedKey = createHash('sha256').update(clientKey).digest()

    const clientSignature = hmac(storedKey, authMessage)

    const clientProofBuf = Buffer.alloc(32)
    
    for (let i = 0; i < 32; i++) {
        clientProofBuf[i] = clientKey[i] ^ clientSignature[i]
    }
    const clientProof = clientProofBuf.toString('base64')

    const serverKey = hmac(saltedPassword, 'Server Key')
    
    const serverSignature = hmac(serverKey, authMessage).toString('base64')

    return { clientProof, serverSignature }
}