import { bench, group, run } from "mitata"
import { Pool as PgtxPool, sql } from "@m2k-5f/pgtx"
import pg from "pg"
import postgres from "postgres"
import assert from "node:assert/strict"

const config = {
  host: process.env.PGHOST || "localhost",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "pgtx_test",
  port: Number(process.env.PGPORT) || 5433,
  max: Number(process.env.PGMAX) || 10
}

const DB_URL =
  `postgres://${config.user}:${config.password}` +
  `@${config.host}:${config.port}/${config.database}`

const pgtx = new PgtxPool(config)
const pgPool = new pg.Pool(config)
const postgresjs = postgres(DB_URL, { max: config.max })

await pgPool.query(`
  DROP TABLE IF EXISTS bench_users;
  CREATE TABLE bench_users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    balance INT NOT NULL
  );

  INSERT INTO bench_users (name, balance)
  SELECT
    'User ' || i,
    floor(random() * 1000)
  FROM generate_series(1, 1000) s(i);
`)

interface User {
  id: number
  name: string
  balance: number
}

function check(user: any, id: number) {
  assert.ok(user)
  assert.equal(user.id, id)
  assert.equal(typeof user.name, "string")
  assert.equal(typeof user.balance, "number")
}

const concurrencyLevels = [
  1,
  2,
  4,
  8,
  16,
  32,
  64,
  128,
  256,
  512,
  1024,
  2048,
  4096,
  8192
]

for (const concurrency of concurrencyLevels) {
  group(`${concurrency} concurrent SELECT`, () => {

    bench("Pgtx", async () => {
      await Promise.all(
        Array.from({ length: concurrency }, async (_, i) => {
          let counter = 0
          const ids = Array.from({length: 5}, (_, j) => (i % 1000) + 1 + j);

          (await pgtx.query<User>`
              SELECT id, name, balance
              FROM bench_users
              WHERE id in (${sql.array(ids)})
          `).forEach(row => check(row, ids[counter++]))
            
        })
      )
    })

    bench("postgres.js", async () => {
      await Promise.all(
        Array.from({ length: concurrency }, async (_, i) => {
          let counter = 0
          const ids = Array.from({length: 5}, (_, j) => (i % 1000) + 1 + j);

          (await postgresjs<User[]>`
            SELECT id, name, balance
            FROM bench_users
            WHERE id in ${postgresjs(ids)}
          `).forEach(user => check(user, ids[counter++]))
        })
      )
    })

    bench("node-postgres", async () => {
      await Promise.all(
        Array.from({ length: concurrency }, (_, i) => {
          const id = (i % 1000) + 1

          return pgPool
            .query<User>(
              `
                SELECT id, name, balance
                FROM bench_users
                WHERE id = $1
              `,
              [id]
            )
            .then(result => check(result.rows[0], id))
        })
      )
    })
  })
}

await run()

await pgtx.close()
await pgPool.end()
await postgresjs.end()