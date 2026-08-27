import { after, describe, it } from "node:test";
import assert from "node:assert";
import { Pool } from "../src";

describe("LISTEN / NOTIFY Async Pipeline Test", async () => {
    const pool = new Pool({
        host: process.env.PGHOST!,
        user: process.env.PGUSER!,
        password: process.env.PGPASSWORD!,
        database: process.env.PGDATABASE!,
        port: Number(process.env.PGPORT),
        max: Number(process.env.PGMAX),
    })

    after(async () => {
        await pool.close()
    })

    it("should successfully deliver notification payload to listener", async () => {
        const channel = "test_channel_basic"
        const expectedPayload = "hello_world_pipeline"
        
        const client = await pool.acquire()
        
        const notificationReceived = new Promise<string>((resolve) => {
            client.listen(channel, (payload) => {
                resolve(payload)
            })
        })

        await client.notify(channel, expectedPayload)

        const timeout = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error("TIMEOUT: Notification response wasn't caught by parser")), 1000)
        )

        try {
            const receivedPayload = await Promise.race([notificationReceived, timeout]);
            assert.strictEqual(receivedPayload, expectedPayload)
        } catch (error: any) {
            assert.fail(error.message)
        } finally {
            pool.release(client)
        }
    })


    it("should support multiple callbacks on the same channel and execute LISTEN only once", async () => {
        const channel = "test_channel_multi"
        const payloadData = "multi_trigger"
        
        const client = await pool.acquire()

        let count1 = 0;
        let count2 = 0;

        const pipeline = await Promise.all([
            client.listen(channel, () => { count1++; }),
            client.listen(channel, () => { count2++; })
        ])

        await client.notify(channel, payloadData)

        await new Promise((resolve) => setTimeout(resolve, 50))

        assert.strictEqual(count1, 1)
        assert.strictEqual(count2, 1)

        pool.release(client)
    })


    it("should correctly handle unlisten and stop triggering callbacks", async () => {
        const channel = "test_channel_unlisten"
        const client = await pool.acquire()

        let triggerCount = 0
        const cb = () => { triggerCount++; }

        await client.listen(channel, cb)
        
        await client.notify(channel, "first")
        await new Promise((resolve) => setTimeout(resolve, 50))
        assert.strictEqual(triggerCount, 1)

        await client.unlisten(channel, cb)

        await client.notify(channel, "second")
        await new Promise((resolve) => setTimeout(resolve, 50))
        
        assert.strictEqual(triggerCount, 1)

        pool.release(client)
    })


    it("should not break pipeline when notification interleaves regular queries", async () => {
        const channel = "test_channel_interleave"
        const client = await pool.acquire()

        let receivedPayload = ""
        await client.listen(channel, (p) => { receivedPayload = p; })

        const pipeline = Promise.all([
            client.query`SELECT pg_sleep(0.1), 'query_1' as res`,
            client.notify(channel, "interleaved_data"),
            client.query`SELECT 'query_2' as res`
        ])

        const timeout = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error("TIMEOUT: Pipeline hung due to incorrect 'A' packet parsing")), 1500)
        )

        try {
            const [res1, _, res2] = await Promise.race([pipeline, timeout]) as any

            assert.strictEqual(res1[0].res, "query_1")
            assert.strictEqual(res2[0].res, "query_2")
            
            assert.strictEqual(receivedPayload, "interleaved_data")
        } catch (error: any) {
            assert.fail(error.message)
        } finally {
            pool.release(client)
        }
    });
});
