import { after, before, describe, it } from "node:test"
import { Pool, sql } from "../src"
import assert from "assert"

const allTypesTableName = "all_datatypes_parsing_test"

type AllTypesRow = {
    id_int4: number
    id_int2: number
    id_int8: bigint | number
    flag_bool: boolean
    text_col: string
    varchar_col: string
    char_col: string
    float4_col: number
    float64_col: number
    bytea_col: Buffer
    json_col: any
    jsonb_col: any
    date_col: Date 
    ts_col: Date   
    tstz_col: Date | string
    uuid_col: string
}

describe("Complete PostgreSQL Binary Datatypes Parsing Test", async () => {
    const pool = new Pool({
        host: process.env.PGHOST || 'localhost',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres',
        database: process.env.PGDATABASE || 'pgtx_test',
        port: Number(process.env.PGPORT) || 5433,
        max: Number(process.env.PGMAX) || 10,
        int8toBigint: true
    })

    before(async () => {
        await pool.query`
            create table if not exists ${sql.literal(allTypesTableName)} (
                id_int4 integer primary key,
                id_int2 smallint not null,
                id_int8 bigint not null,
                flag_bool boolean not null,
                text_col text not null,
                varchar_col varchar(255) not null,
                char_col char(10) not null,
                float4_col real not null,
                float64_col double precision not null,
                bytea_col bytea not null,
                json_col json not null,
                jsonb_col jsonb not null,
                date_col date not null,
                ts_col timestamp not null,
                tstz_col timestamptz not null,
                uuid_col uuid not null
            );`
    })

    after(async () => {
        await pool.query`drop table if exists ${sql.literal(allTypesTableName)};`
        pool.close()
    })

    it("should correctly parse absolutely all specified types in binary mode", async () => {
        await pool.query`truncate table ${sql.ident(allTypesTableName)}`

        const sampleBytea = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd])
        const sampleUuid = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
        
        const testData: AllTypesRow = {
            id_int4: 42000,
            id_int2: 320,
            id_int8: 9223372036854775807n,
            flag_bool: true,
            text_col: "Short text for cache",
            varchar_col: "This is a much longer text string designed to bypass the 32 bytes cache limit completely inside readDataRow", 
            char_col: "fixed     ", 
            float4_col: Math.fround(1.234024),
            float64_col: 123456.789101112,
            bytea_col: sampleBytea,
            json_col: { meta: "data", tags: [1, 2] },
            jsonb_col: { fast: true, nested: { id: 1 } },
            date_col: new Date("2026-08-11"),
            ts_col: new Date("2026-08-11 12:00:00"),
            tstz_col: new Date("2026-08-11 12:00:00+00"),
            uuid_col: sampleUuid
        }

        await pool.query`
            insert into ${sql.ident(allTypesTableName)} ${sql.insert(testData)};
        `

        const [row] = await pool.query<AllTypesRow>`SELECT * FROM ${sql.ident(allTypesTableName)}`

        assert.deepStrictEqual(row, testData)
    })

    it("should return null for all fields when they are NULL in database", async () => {
        const nullTableName = "all_types_null_test"
        
        await pool.query`
            create table if not exists ${sql.literal(nullTableName)} (
                id_int4 integer, id_int2 smallint, id_int8 bigint, flag_bool boolean,
                text_col text, varchar_col varchar(255), char_col char(10),
                float4_col real, float64_col double precision, bytea_col bytea,
                json_col json, jsonb_col jsonb, date_col date, ts_col timestamp, 
                tstz_col timestamptz, uuid_col uuid
            );`

        await pool.query`
            insert into ${sql.literal(nullTableName)} 
            values (null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null);
        `

        const rows = await pool.query<any>`SELECT * FROM ${sql.literal(nullTableName)}`
        const row = rows[0]

        Object.keys(row).forEach(key => {
            assert.strictEqual(row[key], null, `Поле ${key} должно быть null`)
        })

        await pool.query`drop table if exists ${sql.literal(nullTableName)}`
    })
})
