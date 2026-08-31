import { after, before, describe, it } from "node:test"
import { Pool, sql } from "../src"
import assert from "assert"

describe("PostgreSQL Pipeline Batching Error Recovery (Monaic Retry Feature)", async () => {
    const pool = new Pool({
        host: process.env.PGHOST!,
        user: process.env.PGUSER!,
        password: process.env.PGPASSWORD!,
        database: process.env.PGDATABASE!,
        port: Number(process.env.PGPORT),
        max: Number(process.env.PGMAX),
        int8toBigint: true
    })

    const pipelineTestTable = "pipeline_error_recovery_test"

    // Один connection на весь describe — никакого round-robin,
    // никакого beforeEach/beforeEach-сброса состояния между кейсами.
    // Каждый it продолжает ровно с того состояния, в котором его
    // оставил предыдущий — вся цепочка линейна и предсказуема.
    let conn: Awaited<ReturnType<typeof pool.acquire>>

    before(async () => {
        conn = await pool.acquire()

        await conn.query`
            create table if not exists ${sql.ident(pipelineTestTable)} (
                id integer primary key,
                username text unique not null,
                balance integer not null
            );`

        await conn.query`truncate table ${sql.ident(pipelineTestTable)}`

        await conn.query`
            insert into ${sql.ident(pipelineTestTable)} (id, username, balance)
            values (1, 'alice', 1000)
        `
    })

    after(async () => {
        await conn.query`drop table if exists ${sql.ident(pipelineTestTable)};`
        pool.release(conn)
        await pool.close()
    })

    // Состояние после before: alice, balance = 1000

    it("resolves the leading query and rejects the failing one in a batch", async () => {
        const q1 = conn.query`UPDATE ${sql.ident(pipelineTestTable)} SET balance = 1100 WHERE id = 1`
        const q2 = conn.query`INSERT INTO ${sql.ident(pipelineTestTable)} (id, username, balance) VALUES (1, 'fail', 0)`
        const q3 = conn.query<any>`SELECT balance, username FROM ${sql.ident(pipelineTestTable)} WHERE id = 1`

        let q2Error: any = null

        const [r1, r2, r3] = await Promise.all([
            q1,
            q2.catch(err => { q2Error = err; return null }),
            q3
        ])

        assert.strictEqual(q2Error?.code, '23505', "q2 должен вернуть Unique Violation")

        assert.strictEqual(r3[0].balance, 1100, "q3 (после ошибочного q2) должен увидеть уже применённый UPDATE")
        assert.strictEqual(r3[0].username, 'alice')
    })

    // Состояние после предыдущего it: alice, balance = 1100
    // (q1 закоммичен несмотря на ошибку в q2 из той же пачки)

    it("keeps the committed update visible to a fresh query on the same connection", async () => {
        const verify = await conn.query<any>`SELECT balance FROM ${sql.ident(pipelineTestTable)} WHERE id = 1`

        assert.strictEqual(verify[0].balance, 1100, "UPDATE из предыдущего кейса должен остаться закоммиченным")
    })

    // Состояние всё ещё: alice, balance = 1100

    it("resolves the leading query and rejects the failing tail query when the retry itself errors", async () => {
        const q1 = conn.query`UPDATE ${sql.ident(pipelineTestTable)} SET balance = 500 WHERE id = 1`
        const q2 = conn.query`INSERT INTO ${sql.ident(pipelineTestTable)} (id, username, balance) VALUES (1, 'fail', 0)`
        const q3 = conn.query`SELECT uncorrect_tablename FROM ${sql.ident(pipelineTestTable)}`

        let q2Error: any = null
        let q3Error: any = null

        await Promise.all([
            q1,
            q2.catch(err => q2Error = err),
            q3.catch(err => q3Error = err)
        ])

        assert.strictEqual(q2Error?.code, '23505', "q2 должен вернуть Unique Violation")
        assert.strictEqual(q3Error?.code, '42703', "q3 после рерана должен честно вернуть Undefined Column")
    })

    // Состояние после предыдущего it: alice, balance = 500
    // (q1 из третьего кейса закоммичен, несмотря на две ошибки в той же пачке)

    it("keeps the second committed update visible despite two errors in one batch", async () => {
        const verify = await conn.query<any>`SELECT balance FROM ${sql.ident(pipelineTestTable)} WHERE id = 1`

        assert.strictEqual(verify[0].balance, 500, "UPDATE должен пережить обе ошибки в пачке")
    })
})