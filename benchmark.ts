import { run, bench, group } from 'mitata';
import { Pool as PgtxPool } from '@m2k-5f/pgtx';
import pg from 'pg';
import postgres from 'postgres';
import assert from 'node:assert/strict';

export const config = {
  host: process.env.PGHOST || 'localhost',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'pgtx_test',
  port: Number(process.env.PGPORT) || 5433,
  max: Number(process.env.PGMAX) || 10
}

const DB_URL = `postgres://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`
const CONCURRENCY = 3000

const pgtxPool = new PgtxPool(config)
const pgPool = new pg.Pool(config)
const sqlPostgres = postgres(DB_URL, { max: config.max })

interface User { 
  id: number
  name: string
  balance: number
}

function validateUser(user: any, expectedId: number) {
  assert.ok(user)
  assert.equal(user.id, expectedId)
  assert.equal(typeof user.name, 'string')
  assert.equal(typeof user.balance, 'number')
}

await pgPool.query(`
  DROP TABLE IF EXISTS bench_users;
  CREATE TABLE bench_users (id SERIAL PRIMARY KEY, name TEXT, balance INT);
  INSERT INTO bench_users (name, balance) 
  SELECT 'User ' || i, floor(random() * 1000) FROM generate_series(1, 1000) s(i);
`)

group(`${CONCURRENCY} parallel SELECT-queries`, () => {
  bench('postgres.js (Pipeline)', async () => {
    const promises: Promise<void>[] = []
    
    for (let i = 0; i < CONCURRENCY; i++) {
      const targetId = (i % 1000) + 1
      
      const p = sqlPostgres<User[]>`SELECT id, name, balance FROM bench_users WHERE id = ${targetId}`
        .then((res) => {
          const user = res[0]
          validateUser(user, targetId)
        })
        
      promises.push(p)
    }
    
    await Promise.all(promises)
  })

  bench('Pgtx (Pipeline)', async () => {
    const promises: Promise<void>[] = []
    let counter = 0
    
    for (let i = 0; i < CONCURRENCY; i++) {
      const targetId = (i % 1000) + 1
      
      const p = pgtxPool.query<User>`SELECT id, name, balance FROM bench_users WHERE id = ${targetId}`
        .then((res) => {
          const user = res[0]
          validateUser(user, targetId)
          counter++
        })
        
      promises.push(p)
    }
    
    await Promise.all(promises)
    assert.equal(counter, CONCURRENCY)
  })

  

  bench('node-postgres / pg', async () => {
    const promises: Promise<void>[] = []
    
    for (let i = 0; i < CONCURRENCY; i++) {
      const targetId = (i % 1000) + 1
      
      const p = pgPool.query('SELECT id, name, balance FROM bench_users WHERE id = $1', [targetId])
        .then((res: any) => {
          const user = res.rows[0]
          validateUser(user, targetId)
        })
        
      promises.push(p)
    }
    
    await Promise.all(promises)
  })

})

await run()

await pgtxPool.close()
await pgPool.end()
await sqlPostgres.end()
