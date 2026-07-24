import { ColumnDescription } from "../types"

const parsePostgresArray = (v: string): string[] => {
    if (v === '{}') return []

    const str = v.substring(1, v.length - 1)
    
    const matches = str.match(/"(?:\\.|[^"\\])*"|[^,]+/g)
    if (!matches) return []
    
    return matches.map(el => {
        const trimmed = el.trim()
        if (trimmed === 'NULL') return null as any
        
        if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
            return trimmed
                .substring(1, trimmed.length - 1)
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\')
        }
        return trimmed
    })
}


const parsePoint = (v: string) => {
    const [x, y] = v.replace(/[()]/g, '').split(',')
    return { x: parseFloat(x), y: parseFloat(y) }
}


const Parsers: Record<number, (value: string) => unknown> = {
    16:   (v) => v === 't',                        // BOOL
    21:   (v) => parseInt(v, 10),                  // INT2 (SMALLINT)
    23:   (v) => parseInt(v, 10),                  // INT4 (INTEGER)
    26:   (v) => parseInt(v, 10),                  // OID
    20:   (v) => parseInt(v),                        // INT8 (BIGINT)
    700:  (v) => parseFloat(v),                    // FLOAT4 (REAL)
    701:  (v) => parseFloat(v),                    // FLOAT8 (DOUBLE PRECISION)
    1700: (v) => parseFloat(v),                    // NUMERIC (DECIMAL)

    18:   (v) => v,                                // CHAR 
    19:   (v) => v,                                // NAME 
    25:   (v) => v,                                // TEXT
    1042: (v) => v,                                // BPCHAR (CHAR(N))
    1043: (v) => v,                                // VARCHAR
    2950: (v) => v,                                // UUID
    17:   (v) => Buffer.from(v.substring(2), 'hex'), // BYTEA 

    1082: (v) => new Date(v),                      // DATE
    1114: (v) => new Date(v + 'Z'),                // TIMESTAMP
    1184: (v) => new Date(v),                      // TIMESTAMPTZ
    1083: (v) => v,                                // TIME 
    1266: (v) => v,                                // TIMETZ
    1186: (v) => v,                                // INTERVAL


    114:  (v) => JSON.parse(v),                    // JSON
    3802: (v) => JSON.parse(v),                    // JSONB

    869:  (v) => v,                                // INET (IP-адреса)
    650:  (v) => v,                                // CIDR
    829:  (v) => v,                                // MACADDR

    600:  parsePoint,                              // POINT
    603:  (v) => v.replace(/[()]/g, '')            // POLYGON
                .split(',')
                .map(parsePoint), 

                
    1000: (v) => parsePostgresArray(v).map(el => el === 't'),
    1005: (v) => parsePostgresArray(v).map(el => parseInt(el, 10)),
    1007: (v) => parsePostgresArray(v).map(el => parseInt(el, 10)), // int4[]
    1016: (v) => parsePostgresArray(v).map(el => BigInt(el)),       // int8[]
    1021: (v) => parsePostgresArray(v).map(el => parseFloat(el)),
    1022: (v) => parsePostgresArray(v).map(el => parseFloat(el)),   // float8[]
    1231: (v) => parsePostgresArray(v).map(el => parseFloat(el)),   // numeric[]
    1009: (v) => parsePostgresArray(v),                             // text[]
    1015: (v) => parsePostgresArray(v),                             // varchar[]
    199:  (v) => parsePostgresArray(v).map(el => JSON.parse(el)),   // json[]
    3807: (v) => parsePostgresArray(v).map(el => JSON.parse(el)),   // jsonb[]
} as const


const defaultParser = (v: string) => v


export function parseRowValues(columns: ColumnDescription[], rows: (string | null)[][]): Record<string, any> {
    const result: Record<string, any>[] = []
    const columnsLength = columns.length

    const columnParsers = columns.map(col => Parsers[col.typeOID] || defaultParser)

    for (let r = 0; r < rows.length; r++) {
        const rawRow = rows[r]
        const rowObject: Record<string, any> = {}

        for (let c = 0; c < columnsLength; c++) {
            const val = rawRow[c]
            const colName = columns[c].name

            if (val === null) {
                rowObject[colName] = null
                continue
            }

            try {
                rowObject[colName] = columnParsers[c](val)
            } catch {
                rowObject[colName] = val
            }
        }

        result.push(rowObject)
    }

    return result
}


export const setTypeParser = (typeOID: keyof typeof Parsers, parser: (value: string) => unknown) => {
    Parsers[typeOID] = parser
}