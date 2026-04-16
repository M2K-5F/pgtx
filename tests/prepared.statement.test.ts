import { describe, it } from "node:test"
import { deepEqual as assert } from "node:assert"
import { Pool, sql } from "../src"
import { PoolConfig } from "../src/types";

export const config: PoolConfig = {
    host: process.env.PGHOST || 'localhost',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'pgtx_test',
    port: Number(process.env.PGPORT) || 5433,
    max: Number(process.env.PGMAX) || 20 
};

const pool = new Pool(config)

const tablename = "prepared_statements_test"

type Table = {id: number, status: string}

const setup = async () => {
    await pool.query`
    create table if not exists ${sql.literal(tablename)} (
        id bigserial primary key,
        status text not null
    );`
}

const drop = async () => {
    await pool.query`drop table ${sql.literal(tablename)};`
    await pool.query`
    create table if not exists ${sql.literal(tablename)} (
        id bigserial primary key,
        status text not null
    );`
}


describe("prepared Statements test", async () => {
    it('prepared statement test', async () => {
        await setup()
        await drop()

        const stmt = await pool.prepare<Table, [string]>("user select", `select * from ${tablename} where status = ?`)
        await pool.query`insert into ${sql.ident(tablename)} ${sql.insert<Table>(
            {id: 1, status: "success"}, {id: 2, status: "active"},
            {id: 3, status: "success"}, {id: 4, status: "success"}
        )}`

        const rows = await stmt.execute("success")

        assert(rows.map(r => r.id), [1, 3, 4])
    })
})