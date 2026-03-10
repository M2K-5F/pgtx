import { describe, it } from "node:test"
import { deepEqual as assert } from "node:assert"
import { Pool, sql } from "../src"
import { transformWithEsbuild } from "vite"

const pool = new Pool({host: 'localhost', user: 'postgres', database: 'pgtx_test', port: 5433, password: 'postgres'})

const tablename = "transaction_isolation_test"

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

describe("transaction isolation test", async () => {
    await up()
    await down()
    await up()

    await it("transaction test", async () => {
        await pool.begin(async tx => {
            tx.query`insert into ${sql.ident(tablename)} ${sql.insert<Table>({id: 1, status: 'success'}, {id: 2, status: "stable"})}`
        })

        const rows = await pool.query<Table>`SELECT * from ${sql.ident(tablename)}`
        assert(rows, [{id: 1, status: 'success'}, {id: 2, status: "stable"}])
    })

    await it("isolation test", async () => {
        await down()
        await up()

        await pool.begin(async tx => {
            await pool.begin(async tx => {
                await tx.query`insert into ${sql.ident(tablename)} ${sql.insert<Table>({id: 1, status: 'success'}, {id: 2, status: "stable"})}`
                await tx.rollback()
            })

            const rows = await pool.query<Table>`SELECT * from ${sql.ident(tablename)}`
            assert(rows, [])
        })
    })

    await it("savepoints isolation test", async () => {
        await down()
        await up()

        await pool.begin(async tx => {
            await pool.begin(async tx => {
                await tx.query`insert into ${sql.ident(tablename)} ${sql.insert<Table>({id: 1, status: 'success'}, {id: 2, status: "stable"})}`

                try {
                    await tx.savepoint("savepoint 1", async spt => {
                        await spt.query`insert into ${sql.ident(tablename)} ${sql.insert<Table>({id: 3, status: 'success'}, {id: 4, status: "stable"})}`
                        throw new Error("savepoint failed")
                    })
                } catch {}
            })

            const rows = await pool.query<Table>`SELECT * from ${sql.ident(tablename)}`
            assert(rows, [{id: 1, status: 'success'}, {id: 2, status: "stable"}])
        })
    })
})