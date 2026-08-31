import { sql, Pool } from "../src";
import assert from "assert";
import {describe, before, after, it} from "node:test"


const tablename = "benchmark_concurrent"
const TOTAL_REQUESTS = 5000
const CONCURRENCY = 5000

const usersToInsert = [
    { email: 'test1@test.com', name: 'User 1', age: 25 },
    { email: 'test2@test.com', name: 'User 2', age: 30 }
]

const updateData = { 
    last_login: new Date(), 
    status: 'active',
    attempts: 1 
}

const NO_TIMEOUT = { timeout: Infinity }


describe("Performance test", NO_TIMEOUT, () => {
    let pool: Pool
    before(async () => {
        pool = new Pool({
            host: process.env.PGHOST!,
            user: process.env.PGUSER!,
            password: process.env.PGPASSWORD!,
            database: process.env.PGDATABASE!,
            port: Number(process.env.PGPORT),
            max: Number(process.env.PGMAX),
        })

        await pool.query`DROP TABLE IF EXISTS ${sql.ident(tablename)}`
        await pool.query`
            CREATE TABLE ${sql.ident(tablename)} (
                id SERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                age INTEGER,
                status TEXT DEFAULT 'active',
                last_login TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                attempts INTEGER DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )`
        await pool.query`CREATE INDEX IF NOT EXISTS idx_users_status_age ON ${sql.ident(tablename)} (status, age)`

        console.log('Warming')
        
        await runPgtxBench(pool)
    }, NO_TIMEOUT)

    after(async () => {        
        await pool.close()
    }, NO_TIMEOUT)

    it("Throughput test", NO_TIMEOUT, async () => {
        console.log(`\nRunning: ${TOTAL_REQUESTS} requests, ${CONCURRENCY} concurrent workers\n`)

        await runPgtxBench(pool)
    })
})


const runPgtxBench = async (pool: Pool) => {
    let counter = 0
    
    const workers = Array.from({ length: CONCURRENCY }, (_, i) => {
        const queriesPerWorker = Math.ceil(TOTAL_REQUESTS / CONCURRENCY)
        return async () => {
            for (let j = 0; j < queriesPerWorker; j++) {
                const res = await pool.query`
                    INSERT INTO ${sql.ident(tablename)} ${sql.insert(...usersToInsert)}
                    ON CONFLICT (email) 
                    DO UPDATE SET ${sql.update(updateData)}
                    WHERE ${sql.ident(tablename)}.status != ${'blocked'}
                    AND ${sql.ident(tablename)}.age > ${20}
                    returning *
                `
                counter++
                
                assert.strictEqual(res.length, 2, 'Unvalid query result')
            }
            
        }
    })
    
    await Promise.all(workers.map(w => w()))

    
    assert.strictEqual(counter, TOTAL_REQUESTS, "counter mismatch")
}