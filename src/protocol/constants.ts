import { ValueOF } from "../types"

export const RequestTypes = {
    SimpleQuery: "Q",
    Parse: "P",
    Bind: "B",
    Execute: "E",
    Sync: "S",
    Password: "p",
    Describe: 'D',
    Close: "C"
} as const

export type RequestType = ValueOF<typeof RequestTypes>


export const ResponseTypes = {
    RowDescription: "T",
    DataRow: "D",
    ComandComplete: "C",
    ReadyForQuery: "Z",
    ErrorResponse: "E",
    NoticeResponse: "N",
    Authentication: "R",
    BackendKeyData: "K",
    ParamaterStatus: "S",
    ParseComplete: "1",
    BindComplete: "2",
    CloseComplete: "3",
    ParameterDescription: "t",
    NoData: "n",
    Notice: "N"
} as const


export type ResponseType = ValueOF<typeof ResponseTypes>


export const AuthenticationCodes = {
    Ok: 0,
    CleartextPassword: 3,
    MD5Password: 5,
    SASL: 10,
    SASLContinue: 11,
    SASLFinal: 12,
} as const

export type AuthenticationCode = ValueOF<typeof AuthenticationCodes>


export const TransactionStatuses = {
    Idle: "I",
    InTransactionBlock: "T",
    FailedTransactionBlock: "E",
} as const

export type TransactionStatus = ValueOF<typeof TransactionStatuses>
