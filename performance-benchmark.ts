import { Pool as PgPool } from "pg";
import { sql, Pool as PgtxPool, Pool } from "./src";
import assert from "assert";

export const config = {
    host: process.env.PGHOST || 'localhost',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'pgtx_test',
    port: Number(process.env.PGPORT) || 5433,
    max: Number(process.env.PGMAX) || 10
};

const pgtxPool = new PgtxPool({...config})
const pgPool = new PgPool(config)

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

const setup = async () => {
    await pgPool.query(`
        DROP TABLE IF EXISTS "${tablename}";
        CREATE TABLE "${tablename}" (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            age INTEGER,
            status TEXT DEFAULT 'active',
            last_login TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            attempts INTEGER DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_users_status_age ON "${tablename}"(status, age);
    `)
}

const runPgtxBench = async () => {
    const start = Date.now()
    
    const workers = Array.from({ length: CONCURRENCY }, (_, i) => {
        const queriesPerWorker = Math.ceil(TOTAL_REQUESTS / CONCURRENCY)
        return async () => {
            for (let j = 0; j < queriesPerWorker; j++) {
                const res = await pgtxPool.query`
                    INSERT INTO ${sql.ident(tablename)} ${sql.insert(...usersToInsert)}
                    ON CONFLICT (email) 
                    DO UPDATE SET ${sql.update(updateData)}
                    WHERE ${sql.ident(tablename)}.status != ${'blocked'}
                    AND ${sql.ident(tablename)}.age > ${20}
                `
            }
            
        }
    })
    
    await Promise.all(workers.map(w => w()))

    return Date.now() - start
}

const runNativeBench = async () => {
    const nativeSql = `
        INSERT INTO "${tablename}" (email, name, age) 
        VALUES ($1, $2, $3), ($4, $5, $6)
        ON CONFLICT (email) 
        DO UPDATE SET last_login = $7, status = $8, attempts = $9
        WHERE "${tablename}".status != $10
        AND "${tablename}".age > $11
    `

    const params = [
        usersToInsert[0].email, usersToInsert[0].name, usersToInsert[0].age,
        usersToInsert[1].email, usersToInsert[1].name, usersToInsert[1].age,
        updateData.last_login, updateData.status, updateData.attempts,
        'blocked', 20
    ]

    const start = Date.now()
    
    const workers = Array.from({ length: CONCURRENCY }, () => {
        const queriesPerWorker = Math.ceil(TOTAL_REQUESTS / CONCURRENCY)
        return async () => {
            for (let i = 0; i < queriesPerWorker; i++) {
                await pgPool.query(nativeSql, params)
            }
        }
    })

    await Promise.all(workers.map(w => w()))
    
    return Date.now() - start
}

async function run() {
    try {
        await setup()
        
        console.log('Warming')
        await runPgtxBench()
        await runNativeBench()
        
        console.log(`\nRunning: ${TOTAL_REQUESTS} requests, ${CONCURRENCY} concurrent workers\n`)

        const pgtxTime = await runPgtxBench()
        const nativeTime = await runNativeBench()


        const formatResult = (time: number) => ({
            time: `${time}ms`,
            requests: TOTAL_REQUESTS,
            concurrency: CONCURRENCY,
            rps: (TOTAL_REQUESTS / (time / 1000)).toFixed(0),
            avg: (time / TOTAL_REQUESTS).toFixed(3) + 'ms'
        })

        console.table({
            "Native pg (pool)": formatResult(nativeTime),
            "Pgtx (pool)": formatResult(pgtxTime)
        })

        const diff = (((pgtxTime / nativeTime) - 1) * 100).toFixed(2)
        console.log(`\n${diff}% difference`)

    } catch (err) {
        console.error(err)
    } finally {
        await pgPool.end()
        // await pgtxPool.close()
    }
}

run()