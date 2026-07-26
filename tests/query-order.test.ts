import { after, before, describe, it } from "node:test";
import { Pool } from "../src";
import assert from "assert";

describe('Query order test', async () => {
    const pool = new Pool({
        host: process.env.PGHOST || 'localhost',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres',
        database: process.env.PGDATABASE || 'pgtx_test',
        port: Number(process.env.PGPORT) || 5433,
        max: Number(process.env.PGMAX) || 10
    })

    after(async () => {
        await pool.close()
    })


    it("should not skip pipeline after ReadyForQuery", async () => {
        const results = await Promise.all(
            Array.from({length: 100}, async (_, i) => {
                
                return await pool.query`
                    SELECT ${i}::int as value
                `
            }
            )
        )

    
        for (let i = 0; i < 10; i++) {
            assert.strictEqual(
                results[i][0].value,
                i
            )
        }
    })


    it("should switch pipelines only after ReadyForQuery", async () => {

        const batch1 = Promise.all([
            pool.query`SELECT 1 as batch, pg_sleep(0.05)`,
            pool.query`SELECT 2 as batch`,
        ])


        await new Promise(r => setImmediate(r))


        const batch2 = Promise.all([
            pool.query`SELECT 3 as batch`,
            pool.query`SELECT 4 as batch`,
        ])


        const result = await Promise.all([
            batch1,
            batch2
        ])


        assert.strictEqual(result[0][0][0].batch, 1)
        assert.strictEqual(result[0][1][0].batch, 2)

        assert.strictEqual(result[1][0][0].batch, 3)
        assert.strictEqual(result[1][1][0].batch, 4)
    })


    it("should handle multiple flush batches correctly", async () => {
        const batch1 = []

        for (let i = 0; i < 50; i++) {
            batch1.push(
                pool.query`
                    SELECT ${i}::int as value
                `
            )
        }

        await new Promise(r => setImmediate(r))


        const batch2 = []

        for (let i = 50; i < 100; i++) {
            batch2.push(
                pool.query`
                    SELECT ${i}::int as value
                `
            )
        }


        const results = await Promise.all([
            ...batch1,
            ...batch2
        ])


        for (let i = 0; i < 100; i++) {
            assert.strictEqual(results[i][0].value, i)
        }
    })

    it("should reject pending queries after pipeline error", async () => {
        const queries = [
            pool.query`
                SELECT 1 as value
            `,

            pool.query`
                SELECT * FROM table_that_does_not_exist
            `,

            pool.query`
                SELECT 3 as value
            `
        ]


        const timeout = new Promise((_, reject) =>
            setTimeout(
                () => reject(new Error("Pipeline hung after error")),
                1000
            )
        )


        try {
            await Promise.race([
                Promise.all(queries),
                timeout
            ])

            assert.fail("Expected pipeline to reject")

        } catch (err: any) {
            assert.notStrictEqual(
                err.message,
                "Pipeline hung after error"
            )
        }
    })
})