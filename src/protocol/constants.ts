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
    Notice: "N",
    NotificationResponse: "A",
    SSLOk: "S",
    SSLDenied: "N"
} as const


export const DataTypeOids = {
    Bool: 16,
    Bytea: 17, 

    Char: 18,
    Name: 19,
    Text: 25,
    Varchar: 1043,
    Bpchar: 1042, 

    
    Int2: 21, 
    Int4: 23, 
    Int8: 20, 

    Float4: 700, 
    Float8: 701, 
    Numeric: 1700, 

    Timestamp: 1114,    
    Timestamptz: 1184,  
    Date: 1082,
    Time: 1083,
    Timetz: 1266,
    Interval: 1186,

    Json: 114,
    Jsonb: 3802,

    Uuid: 2950,
    Cidr: 650,
    Inet: 869,
    Macaddr: 829,

    Oid: 26,
    Xid: 28,
    Cid: 29,
    Regproc: 24,

    Point: 600,
    Lseg: 601,
    Path: 602,
    Box: 603,
    Polygon: 604,
    Line: 628,

    BoolArray: 1000,
    Int2Array: 1005,
    Int4Array: 1007,
    Int8Array: 1016,
    TextArray: 1009,
    VarcharArray: 1015,
    JsonArray: 199,
    JsonbArray: 3807,
    UuidArray: 2951,
    NumericArray: 1231
} as const

export type DataTypeOid = typeof DataTypeOids[keyof typeof DataTypeOids];

export const INT4Length = 4

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
