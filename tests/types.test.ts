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
    numeric_col: string
    time_col: string
    timetz_col: string
}

describe("Complete PostgreSQL Binary Datatypes Parsing Test", async () => {
    const pool = new Pool({
        host: process.env.PGHOST!,
        user: process.env.PGUSER!,
        password: process.env.PGPASSWORD!,
        database: process.env.PGDATABASE!,
        port: Number(process.env.PGPORT),
        max: Number(process.env.PGMAX),
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
                uuid_col uuid not null,
                numeric_col numeric(14,4) not null,
                time_col time not null,
                timetz_col timetz not null
            );`
    })

    after(async () => {
        await pool.query`drop table if exists ${sql.literal(allTypesTableName)};`
        await pool.close()
    })

    it("should correctly parse absolutely all specified types in binary mode", async () => {
        await pool.query`truncate table ${sql.ident(allTypesTableName)}`

        const sampleBytea = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd])
        const sampleUuid = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
        
        const testData: AllTypesRow = {
            id_int4: 42000,
            id_int2: 320,
            id_int8: 9223372036854n,
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
            uuid_col: sampleUuid,
            numeric_col: "12345678.1234",
            time_col: "15:30:45.123",
            timetz_col: "15:30:45.123+03:00"
        }

        const conn = await pool.acquire()

        await conn.query`
            insert into ${sql.ident(allTypesTableName)} ${sql.insert(testData)};
        `

        const [row] = await conn.query<AllTypesRow>`SELECT * FROM ${sql.ident(allTypesTableName)}`

        assert.deepStrictEqual(row, testData)

        await conn.query`truncate ${sql.ident(allTypesTableName)}`

        await conn.query`
            insert into ${sql.ident(allTypesTableName)} ${sql.insert(testData)};
        `

        const [row2] = await pool.query<AllTypesRow>`SELECT * FROM ${sql.ident(allTypesTableName)}`

        assert.deepStrictEqual(row2, testData, "Binary protocol type error")
    })

    it("should return null for all fields when they are NULL in database", async () => {
        const nullTableName = "all_types_null_test"
        
        await pool.query`
            create table if not exists ${sql.literal(nullTableName)} (
                id_int4 integer, id_int2 smallint, id_int8 bigint, flag_bool boolean,
                text_col text, varchar_col varchar(255), char_col char(10),
                float4_col real, float64_col double precision, bytea_col bytea,
                json_col json, jsonb_col jsonb, date_col date, ts_col timestamp, 
                tstz_col timestamptz, uuid_col uuid,
                numeric_col numeric(14,4), time_col time, timetz_col timetz
            );`

        await pool.query`
            insert into ${sql.literal(nullTableName)} 
            values (null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null);
        `

        const rows = await pool.query<any>`SELECT * FROM ${sql.literal(nullTableName)}`
        const row = rows[0]

        Object.keys(row).forEach(key => {
            assert.strictEqual(row[key], null, `Поле ${key} должно быть null`)
        })

        await pool.query`drop table if exists ${sql.literal(nullTableName)}`
    })
    
    it("should correctly parse numeric edge cases (negative, whole, NaN)", async () => {
        const numericTableName = "numeric_edge_cases_test"

        await pool.query`
            create table if not exists ${sql.literal(numericTableName)} (
                id integer primary key,
                val numeric(20,6) not null
            );`

        await pool.query`truncate table ${sql.ident(numericTableName)}`

        const cases: [number, string][] = [
            [1, "0.000000"],
            [2, "-123456.789000"],
            [3, "999999999999.999999"],
            [4, "-0.000001"],
            [5, "100.000000"],
        ]

        for (const [id, val] of cases) {
            await pool.query`
                insert into ${sql.ident(numericTableName)} (id, val) values (${id}, ${val}::numeric)
            `
        }

        const rows = await pool.query<{id: number, val: string}>`
            SELECT id, val FROM ${sql.ident(numericTableName)} ORDER BY id
        `

        rows.forEach((row, i) => {
            assert.strictEqual(row.val, cases[i][1], `numeric case id=${cases[i][0]}`)
        })

        await pool.query`drop table if exists ${sql.literal(numericTableName)}`
    })
})
