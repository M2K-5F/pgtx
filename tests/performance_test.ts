import { Pool as PgPool } from "pg";
import { sql, Pool as PgtxPool } from "../src";

const config = {
    host: 'localhost',
    user: 'postgres',
    password: "postgres",
    database: 'pgtx_test',
    port: 5433,
    max: 20 
}

const pgtxPool = new PgtxPool(config)
const pgPool = new PgPool(config)

const tablename = "benchmark_complex"
const iterations = 5000

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
        CREATE TABLE IF NOT EXISTS "${tablename}" (
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
    for (let i = 0; i < iterations; i++) {
        await pgtxPool.query`
            INSERT INTO ${sql.ident(tablename)} ${sql.insert(...usersToInsert)}
            ON CONFLICT (email) 
            DO UPDATE SET ${sql.update(updateData)}
            WHERE ${sql.ident(tablename)}.status != ${'blocked'}
            AND ${sql.ident(tablename)}.age > ${20}
        `
    }
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

    const start = Date.now()
    for (let i = 0; i < iterations; i++) {
        const params = [
            usersToInsert[0].email, usersToInsert[0].name, usersToInsert[0].age,
            usersToInsert[1].email, usersToInsert[1].name, usersToInsert[1].age,
            updateData.last_login, updateData.status, updateData.attempts,
            'blocked', 20
        ]
        await pgPool.query(nativeSql, params)
    }
    return Date.now() - start
}

async function run() {
    try {
        await setup()

        await runPgtxBench()
        await runNativeBench()

        const pgtxTime = await runPgtxBench()
        const nativeTime = await runNativeBench()

        const formatResult = (time: number) => ({
            time: `${time}ms`,
            rps: (iterations / (time / 1000)).toFixed(0),
            avg: (time / iterations).toFixed(3) + 'ms'
        })

        console.table({
            "Native pg": formatResult(nativeTime),
            "Pgtx": formatResult(pgtxTime)
        })

        const diff = (((pgtxTime / nativeTime) - 1) * 100).toFixed(2)
        console.log(`\nResult: ${diff}% difference`)

    } catch (err) {
        console.error(err)
    } finally {
        await pgPool.end()
        await pgtxPool.close()
    }
}

run()
