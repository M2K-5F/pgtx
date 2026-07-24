import { createHash } from "crypto";

export const encryptMd5 = (password: string, user: string, salt: Buffer) => {
    const stage1 = createHash('md5').update(password + user).digest('hex')

    const stage2 = createHash('md5')
        .update(Buffer.concat([Buffer.from(stage1), salt]))
        .digest('hex')
        
    return 'md5' + stage2
}