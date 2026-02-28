import { Pool, PoolConfig } from "pg";
import { sql } from "..";
import { PgtxPool } from "../src/pool";

const config: PoolConfig = {
    host: 'localhost',
    user: 'postgres',
    password: "postgres",
    database: 'pgtx_test',
    port: 5433,
    max: 20 
}

const myPool = new PgtxPool(config)
const nativePool = new Pool(config)

async function runBenchmark() {
    const iterations = 10000
    const userId = 1

    console.log(`--- Запуск интеграционного теста: ${iterations} запросов ---\n`)

    await nativePool.query("CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT)")
    await nativePool.query("INSERT INTO users (name) VALUES ('Benchmark') ON CONFLICT DO NOTHING")

    // 1. Тест: Нативный pg.query (Эталон)
    const startNative = Date.now()
    for (let i = 0; i < iterations; i++) {
        await nativePool.query("SELECT * FROM users WHERE id = $1", [userId])
    }
    const endNative = Date.now()
    console.log(`Нативный pg.query: ${endNative - startNative} мс (${(iterations / ((endNative - startNative) / 1000)).toFixed(0)} RPS)`)

    // 2. Тест: Твой PgtxPool (с кэшированием в QueryBuilder)
    await myPool.query`SELECT * FROM users WHERE id = ${userId}`

    const startMy = Date.now()
    for (let i = 0; i < iterations; i++) {
        await myPool.query`SELECT * FROM users WHERE id = ${userId}`
    }
    const endMy = Date.now()
    console.log(`Твой PgtxPool: ${endMy - startMy} мс (${(iterations / ((endMy - startMy) / 1000)).toFixed(0)} RPS)`)

    // 3. Тест: Сложный запрос с Clause (без кэша структуры)
    const startComplex = Date.now()
    for (let i = 0; i < iterations; i++) {
        await myPool.query`SELECT * FROM ${sql.ident("users")} WHERE id = ${userId}`
    }
    const endComplex = Date.now()
    console.log(`Сложный запрос (IdentClause): ${endComplex - startComplex} мс`)

    await nativePool.end()
}


async function runComplexBenchmark() {
    const tablename = "testcase_1"
    const iterations = 500;
    
    const usersToInsert = [
        { email: 'test1@test.com', name: 'User 1', age: 25 },
        { email: 'test2@test.com', name: 'User 2', age: 30 }
    ];

    const updateData = { 
        last_login: new Date(), 
        status: 'active',
        attempts: 1 
    };

    await myPool.query
        `CREATE TABLE IF NOT EXISTS ${sql.ident(tablename)} (
        id SERIAL PRIMARY KEY,
        
        email TEXT UNIQUE NOT NULL,
        
        name TEXT NOT NULL,
        age INTEGER,
        
        status TEXT DEFAULT 'active',
        last_login TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        attempts INTEGER DEFAULT 0,
        
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`

    await myPool.query`CREATE INDEX IF NOT EXISTS idx_users_status_age ON ${sql.ident(tablename)}(status, age);`

    console.log(`--- Запуск Heavy Hybrid теста: ${iterations} итераций ---\n`);

    await myPool.query`
        INSERT INTO ${sql.ident(tablename)} ${sql.insert(...usersToInsert)}
        ON CONFLICT (email) 
        DO UPDATE SET ${sql.update(updateData)}
        WHERE ${sql.ident(tablename)}.status != ${'blocked'}
    `;

    const start = Date.now();

    for (let i = 0; i < iterations; i++) {
        await myPool.query`
            INSERT INTO ${sql.ident(tablename)} ${sql.insert(...usersToInsert)}
            ON CONFLICT (email) 
            DO UPDATE SET ${sql.update(updateData)}
            WHERE ${sql.ident(tablename)}.status != ${'blocked'}
            AND ${sql.ident(tablename)}.age > ${20}
        `;
    }

    const end = Date.now();
    const duration = end - start;

    const startNative = Date.now();
    
    const nativeSql = `
        INSERT INTO "${tablename}" (email, name, age) 
        VALUES ($1, $2, $3), ($4, $5, $6)
        ON CONFLICT (email) 
        DO UPDATE SET last_login = $7, status = $8, attempts = $9
        WHERE "${tablename}".status != $10
        AND "${tablename}".age > $11
    `;

    for (let i = 0; i < iterations; i++) {
        const params = [
            usersToInsert[0].email, usersToInsert[0].name, usersToInsert[0].age,
            usersToInsert[1].email, usersToInsert[1].name, usersToInsert[1].age,
            updateData.last_login, updateData.status, updateData.attempts,
            'blocked', 20
        ];
        await nativePool.query(nativeSql, params);
    }
    const endNative = Date.now();
    console.log(`Нативный pg.query: ${endNative - startNative} мс (${(iterations / ((endNative - startNative) / 1000)).toFixed(0)} RPS)`);
    
    console.log(`Результаты Heavy Hybrid:`);
    console.log(`Общее время: ${duration} мс`);
    console.log(`Среднее время запроса: ${(duration / iterations).toFixed(3)} мс`);
    console.log(`RPS: ${(iterations / (duration / 1000)).toFixed(0)}`);
}

runComplexBenchmark().catch(console.error);

runBenchmark().catch(console.error)