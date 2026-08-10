import { after, before, describe, it } from "node:test"
import { Pool, sql } from "../src"
import assert, { rejects, throws } from "assert"

const tablename = "transaction_isolation_test"

type Table = {id: number, status: string}


describe("Transaction isolation test", async () => {
    const pool = new Pool({
        host: process.env.PGHOST || 'localhost',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres',
        database: process.env.PGDATABASE || 'pgtx_test',
        port: Number(process.env.PGPORT) || 5433,
        max: Number(process.env.PGMAX) || 10
    })

    before(async () => {
        await pool.query`
            create table if not exists ${sql.literal(tablename)} (
                id bigserial primary key,
                status text not null
            );`
        await pool.query`
            truncate table ${sql.literal(tablename)}
            `
    })

    after(async () => {
        await pool.close()
    })

    
    it("transaction test", async () => {
        await pool.begin(async tx => {
            await tx.query`
            insert into ${sql.ident(tablename)} 
            ${sql.insert<Table>({id: 1, status: 'success'}, {id: 2, status: "stable"})}`
        })

        const rows = await pool.query<Table>`SELECT * from ${sql.ident(tablename)}`
        assert.deepStrictEqual(rows, [{id: 1, status: 'success'}, {id: 2, status: "stable"}])
    })


    it("isolation test", async () => {
        await pool.query`
        truncate table ${sql.ident(tablename)}`

        await pool.begin(async tx => {
            await tx.query`insert into ${sql.ident(tablename)} ${sql.insert<Table>({id: 1, status: 'success'}, {id: 2, status: "stable"})}`
            await tx.rollback()
        })

        const rows = await pool.query<Table>`SELECT * from ${sql.ident(tablename)}`
        assert.deepStrictEqual(rows, [])
    })


    it("parrallel transaction isolation test", async () => {
        await pool.query`
        truncate table ${sql.ident(tablename)}`

        const conn1 = await pool.acquire()
        const conn2 = await pool.acquire()

        await conn1.begin(async tx1 => {
            await tx1.query`insert into ${sql.ident(tablename)} ${sql.insert<Table>({id: 1, status: 'success'}, {id: 2, status: "stable"})}`

            await conn2.begin(async tx2 => {
                const [rowBeforeCommit] = await tx2.query`SELECT count(*) from ${sql.ident(tablename)}`
                assert.deepStrictEqual(rowBeforeCommit.count, 0)

                await tx1.commit()
                
                const [rowAfterCommit] = await tx2.query`SELECT count(*) from ${sql.ident(tablename)}`
                
                assert.deepStrictEqual(rowAfterCommit.count, 2)
            })
        })

        pool.release(conn1); pool.release(conn2);
    })

    it("savepoints isolation test", async () => {
        await pool.query`
        truncate table ${sql.ident(tablename)}`

        await pool.begin(async tx => {
            await tx.query`insert into ${sql.ident(tablename)} ${sql.insert<Table>({id: 1, status: 'success'})}`

            await tx.savepoint("savepoint 1", async spt => {
                await tx.query`insert into ${sql.ident(tablename)} ${sql.insert<Table>({id: 2, status: "stable"})}`
            })

            await rejects(
                async () => 
                    await tx.savepoint("savepoint 2", async spt => {
                        await spt.query`insert into ${sql.ident(tablename)} ${sql.insert<Table>({id: 3, status: 'success'}, {id: 4, status: "stable"})}`
                        throw new Error("savepoint failed")
                    }),
                new Error("savepoint failed")
            )
        })

        const rows = await pool.query<Table>`SELECT * from ${sql.ident(tablename)}`
        
        assert.deepStrictEqual(rows, [{id: 1, status: 'success'}, {id: 2, status: "stable"}])
    })
})