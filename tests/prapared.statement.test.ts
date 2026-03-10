import { describe, it } from "node:test"
import { deepEqual as assert } from "node:assert"
import { Pool, sql } from "../src"

const pool = new Pool({host: 'localhost', user: 'postgres', database: 'pgtx_test', port: 5433, password: 'postgres'})

const tablename = "prepared_statements_test"

type Table = {id: number, status: string}

const up = async () => {
    await pool.query`
    create table if not exists ${sql.literal(tablename)} (
        id bigserial primary key,
        status text not null
    );`
}

const down = async () => {
    await pool.query`drop table ${sql.literal(tablename)};`
}


describe("prepared Statements test", async () => {
    await up()
    await down()
    await up()

    const stmt = await pool.prepare<Table>("user select", `select * from ${tablename} where status = ?`)
    await pool.query`insert into ${sql.ident(tablename)} ${sql.insert<Table>(
        {id: 1, status: "success"}, {id: 2, status: "active"},
        {id: 3, status: "success"}, {id: 4, status: "success"}
    )}`

    const rows = await stmt.execute("success")

    assert(rows.map(r => r.id), [1, 3, 4])
})