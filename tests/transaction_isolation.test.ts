import { describe, it } from "node:test"
import { deepEqual as assert } from "node:assert"
import { Pool, sql } from "../src"

const pool = new Pool({host: 'localhost', user: 'postgres', database: 'pgtx_test', port: 5433, password: 'postgres'})

const tablename = "transaction_isolation_test"

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

describe("transaction isolation test", async () => {
    await setup()
    await drop()

    await it("transaction test", async () => {
        await pool.begin(async tx => {
            await tx.query`insert into ${sql.ident(tablename)} ${sql.insert<Table>({id: 1, status: 'success'}, {id: 2, status: "stable"})}`
        })

        const rows = await pool.query<Table>`SELECT * from ${sql.ident(tablename)}`
        assert(rows, [{id: 1, status: 'success'}, {id: 2, status: "stable"}])
    })

    await it("isolation test", async () => {
        await drop()

        await pool.begin(async tx => {
            await tx.query`insert into ${sql.ident(tablename)} ${sql.insert<Table>({id: 1, status: 'success'}, {id: 2, status: "stable"})}`
            await tx.rollback()
        })

        const rows = await pool.query<Table>`SELECT * from ${sql.ident(tablename)}`
        assert(rows, [])
    })

    await it("parrallel transaction isolation test", async () => {
        await drop()

        const conn1 = await pool.acquire()
        const conn2 = await pool.acquire()

        await conn1.begin(async tx1 => {
            await tx1.query`insert into ${sql.ident(tablename)} ${sql.insert<Table>({id: 1, status: 'success'}, {id: 2, status: "stable"})}`

            await conn2.begin(async tx2 => {
                const [rowBeforeCommit] = await tx2.query`SELECT count(*) from ${sql.ident(tablename)}`
                assert(rowBeforeCommit.count, 0)

                await tx1.commit()
                
                const [rowAfterCommit] = await tx2.query`SELECT count(*) from ${sql.ident(tablename)}`
                
                assert(rowAfterCommit.count, 2)
            })
        })

        await conn1.release(); await conn2.release()
    })

    await it("savepoints isolation test", async () => {
        await drop()

        await pool.begin(async tx => {
            await tx.query`insert into ${sql.ident(tablename)} ${sql.insert<Table>({id: 1, status: 'success'})}`

            await tx.savepoint("savepoint 1", async spt => {
                await tx.query`insert into ${sql.ident(tablename)} ${sql.insert<Table>({id: 2, status: "stable"})}`
            })

            const err = await tx.savepoint("savepoint 2", async spt => {
                await spt.query`insert into ${sql.ident(tablename)} ${sql.insert<Table>({id: 3, status: 'success'}, {id: 4, status: "stable"})}`
                throw new Error("savepoint failed")
            })

            assert(err, new Error("savepoint failed"))
        })

        const rows = await pool.query<Table>`SELECT * from ${sql.ident(tablename)}`
        
        assert(rows, [{id: 1, status: 'success'}, {id: 2, status: "stable"}])
    })
})