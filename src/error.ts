export class PostgresError extends Error {
    constructor(
        public override message: string, 
        public code: string = 'undeclared', 
        public detail: string = '', 
        public severity: string = '',
        public where: string = '',
        public hint: string = '',          
        public position: string = '',      
        public dataType: string = '',      
        public constraint: string = ''     
    ) {
        super(message)
        this.name = "PostgresError"
    }


    // Parse error
    get isParseError(): boolean {
        return this.code.startsWith('42')
    }


    // Execute error
    get isDeadlock(): boolean {
        return this.code === '40P01'
    }


    // Execute error
    get isConstraintViolation(): boolean {
        return this.code.startsWith('23')
    }


    get isTimeout(): boolean {
        return this.code === '57014'
    }


    get isConnectionFailure(): boolean {
        return this.code.startsWith('08') || this.code.startsWith('57') && this.code !== '57014'
    }
}

export const ErrQueryTimeout = new PostgresError('Query timeout', '57014')

export const ErrConnectionClosed = new PostgresError("Connection is closed", 'connection_closed', "", "ERROR")
export const ErrConnectionReconnecting = new PostgresError("Connection are reconnecting", "connection_reconnecting", "", "ERROR")