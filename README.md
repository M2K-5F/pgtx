  ## 🚀 Pgtx

  [![Tests](https://github.com/M2K-5F/pgtx/actions/workflows/tests.yaml/badge.svg)](https://github.com/M2K-5F/pgtx/actions/workflows/tests.yaml)
  [![npm version](https://img.shields.io/npm/v/@m2k-5f/pgtx.svg)](https://www.npmjs.com/package/@m2k-5f/pgtx)

  **Blazing-fast PostgreSQL driver for Node.js.**

  Pipeline execution, automatic prepared statements, typed SQL, transactions, and zero dependencies.

  **Up to 25% faster than `Postgres.js` and 15.6× faster than `pg` in concurrent pipeline workloads.**

  ---

  ## 📦 Installation

  ```bash
  npm install @m2k-5f/pgtx
  # yarn add @m2k-5f/pgtx
  # pnpm add @m2k-5f/pgtx
  # bun add @m2k-5f/pgtx
  ```

  ---
  
  ## 🚀 Quick Start

  ```typescript
  import { sql, Pool } from "@m2k-5f/pgtx";

  const pool = new Pool({
    host: 'localhost',
    user: 'postgres',
    password: 'postgres',
    database: 'myapp'
  })

  // Type-safe query
  const [user] = await pool.query<User>`SELECT * FROM users WHERE id = ${1}`

  // Bulk insert
  await pool.query`
    INSERT INTO users ${sql.insert([{ name: 'Alice', age: 25 }, { name: 'Bob', age: 30 }])}
  `

  // Transaction
  await pool.begin(async (tx) => {
    await tx.query`UPDATE accounts SET balance = balance - 100 WHERE id = ${1}`
    await tx.query`UPDATE accounts SET balance = balance + 100 WHERE id = ${2}`
  })
  ```

  ---

  ## ✨ Features

  - **Pipeline queries** — Automatic query multiplexing over PostgreSQL pipeline protocol
  - **Tagged templates** — Natural SQL with type safety
  - **Transactions & Savepoints** — Nested transactions with rollback
  - **Bulk inserts** — Auto-extract columns from objects
  - **Dynamic updates** — Generate SET clauses from objects
  - **Recursive fragments** — Compose SQL like Lego
  - **Prepared statements** — Automatic prepared statement caching
  - **Connection pool** — Auto-management connections with support for pipeline queries via the pool itself.
  - **Zero dependencies** — Lightweight and blazing

  ---

  ## ⚡ Performance & Benchmarks

  ### 1. In-Engine Pipeline Blast (3000 Parallel Queries)
  *Measured using `mitata` inside GitHub Actions cloud runners (Ubuntu, 2 vCPUs, 10 DB Connections).*

  | Driver | Avg Time per Iteration | Relative Speed | Memory (p75) |
  | :--- | :---: | :---: | :---: |
  | **Pgtx (Pipeline)** | **19.21 ms** | **Baseline (3.6×)** | **874.71 KB** |
  | Postgres.js (Pipeline) | 70.50 ms | 3.6× Slower | 1.29 MB |
  | node-postgres (no pipeline) | 327.07 ms | 17.0× Slower | 4.05 MB |

  > **Stability Note:** Pgtx provides an rock-solid flat latency graph (p99 is strictly bounded to `21.76 ms`), while maintaining a 2.5× smaller memory footprint compared to Postgres.js due to zero-allocation binary parsing.

  ### 2. Real-World HTTP Throughput (`wrk` Stress Test)
  *HTTP server baseline using a `node:http` instance on GitHub Actions runner, handling 1,000 concurrent network connections (`wrk -t2 -c1000 -d10s`).*

  - **Pgtx:**  **~14,500 RPS**
  - **Postgres.js:**  **~11,500 RPS**

  On high-concurrency bare metal servers, Pgtx effortlessly maintains a **+25% performance lead** over Postgres.js.

  Pgtx achieves high throughput by:

  * Pipeline query multiplexing
  * Synchronous protocol encoding
  * Batched socket writes
  * Automatic prepared statement caching
  * Row description caching
  * Zero-dependency implementation
  * Binary protocol support

  > Benchmarks source is available in the repository and can be reproduced locally.

  ---

  ## 🔥 Why Pgtx?

  | Capability                          | **Pgtx** | **Postgres.js** | **pg** |
  | -------------------------------- | :------: | :-------------: | :----: |
  | Pipeline queries                 |     ✅    |        ✅        |    ❌   |
  | Pipeline multiplexing in pool    |     ✅    |        ❌        |    ❌   |
  | Tagged template SQL              |     ✅    |        ✅        |    ❌   |
  | Automatic prepared statements    |     ✅    |        ✅        |    ✅   |
  | Prepared statement deduplication |     ✅    |        ❌        |    ❌   |
  | Transactions                     |     ✅    |        ✅        |    ✅   |
  | Savepoints                       |     ✅    |        ✅        |    ❌   |
  | LISTEN / NOTIFY                  |     ✅    |        ✅        |    ✅   |
  | Connection pool                  |     ✅    |        ✅        |    ✅   |
  | Zero dependencies                |     ✅    |        ✅        |    ❌   |

  ---


  ## 📖 Features

  ### 🎯 Typed Error Handling

  Pgtx queries return `Future<T, PostgresError>` from [fluent-future](https://www.npmjs.com/package/fluent-future) instead of raw `Promise<T>`. This gives you:

  - **Typed errors** — `PostgresError` with `code`, `severity`, `detail`
  - **Declarative recovery** — `.recover()`, `.recoverIf()` instead of try/catch
  - **Chain composition** — `.andThen()`, `.orElse()`, `.tap()`, `.tapErr()`

  ```typescript
  const users = await pool.query<User>`SELECT * FROM users WHERE id = ${1}`
    .recoverIf(err => err.code === '42P01', [])  // undefined_table → []
    .recoverIf(err => err.code === '23505', [])  // unique_violation → []
    .tapErr(err => logger.error(err))            // log remaining errors
  ```

  ---

  ### Pipeline by Default

  `Bind` and `.bind` from [fluent-future](https://www.npmjs.com/package/fluent-future) automatically multiplex independent queries over PostgreSQL pipeline protocol — no manual batching required:

  ```typescript
  // 5 queries, only 2 network round-trips
  const {user, posts, ...data} = await Bind({
    user: () => pool.query<User>`...`,
    config: () => pool.query<Config>`...`,
    announcements: () => pool.query<Announcement>`...`
  })
  .bind({
    posts: ({ user }) => pool.query<Post>`...`,
    notifications: ({ user }) => pool.query<Notif>`...`
  })
  ```
  > 🚀 Pgtx automatically groups concurrent queries into pipeline batches, reducing network overhead by up to 5x compared to sequential queries.


  ### Transactions & Savepoints

  ```typescript
  await pool.begin(async (tx) => {
    await tx.query`INSERT INTO orders (user_id) VALUES (${userId})`
    
    await tx.savepoint('update_stock', async (stx) => {
      await stx.query`UPDATE stock SET count = count - 1 WHERE product_id = ${productId}`
      if (outOfStock) throw new Error('out of stock') // Only savepoint rolls back
    })
    .tapErr(console.log) // Error: out of stock
  })
  ```


  ### Async Notifications (LISTEN / NOTIFY)

  Pgtx natively handles PostgreSQL `LISTEN/NOTIFY` protocol messages asynchronously without interrupting multiplexed query pipeline.

  ```typescript
  // 1. Sending a notification
  await pool.notify('user_events', JSON.stringify({ id: 42, action: 'signup' }))

  // 2. Receiving notifications (Requires a dedicated connection from the pool)
  const conn = await pool.acquire()

  const onEvent = (payload: string) => {
    console.log(`Received payload: ${payload}`)
  }

  // Multiplexes multiple callbacks onto a single LISTEN command seamlessly
  await conn.listen('user_events', onEvent)
  await conn.listen('user_events', (data) => logToFile(data))

  // Clean up callbacks (Sends UNLISTEN only when the channel has zero callbacks left)
  await conn.unlisten('user_events', onEvent)

  // Keep the connection active as long as you need notifications!
  // Do NOT release it back to the pool prematurely.
  ```

  > ⚠️ **Architecture Note:** While `notify` is atomic and can be triggered directly from the `Pool` on any random socket, `listen` and `unlisten` are stateful commands tied to a specific PostgreSQL backend process. Therefore, subscription methods are **strictly available only on explicit `Connection` instances** fetched via `pool.acquire()`.


  ### Bulk Inserts

  ```typescript
  const users = [
    { name: 'Alice', email: 'alice@test.com' },
    { name: 'Bob', email: 'bob@test.com' }
  ]

  await pool.query`
    INSERT INTO users ${sql.insert(users)}
  `
  // INSERT INTO users (name, email) VALUES ($1, $2), ($3, $4)
  ```

  ### Dynamic Updates

  ```typescript
  const data = { status: 'active', last_login: new Date() }

  await pool.query`
    UPDATE users SET ${sql.update(data)} WHERE id = ${userId}
  `
  // UPDATE users SET status = $1, last_login = $2 WHERE id = $3
  ```

  ### Recursive Fragments

  ```typescript
  const filter = sql.fragment`status = ${'active'} AND age > ${21}`
  const subquery = sql.fragment`(SELECT id FROM roles WHERE name = ${'admin'})`

  await pool.query`
    SELECT * FROM users 
    WHERE ${filter} AND role_id = (${subquery})
  `
  ```

  ### Smart Lists

  ```typescript
  const ids = [10, 20, 30]
  await pool.query`
    SELECT * FROM users WHERE id IN (${sql.array(ids)})
  `
  // SELECT * FROM users WHERE id IN ($1, $2, $3)

  const conditions = [
    sql.fragment`status = ${'active'}`,
    sql.fragment`age > ${18}`
  ]
  await pool.query`
    SELECT * FROM users WHERE ${sql.array(conditions, ' AND ')}
  `
  ```

  ### Clean WHERE Clauses

  ```typescript
  const filters = { role: 'admin', age: undefined, active: true }
  await pool.query`
    SELECT * FROM users WHERE ${sql.where(filters)}
  `
  // SELECT * FROM users WHERE role = $1 AND active = $2
  ```

  ### Conditional Logic

  ```typescript
  const search = ""
  await pool.query`
    SELECT * FROM posts 
    ${search ? sql.fragment`WHERE title ILIKE ${search}` : sql.empty}
  `
  ```

  ---

  ## 🛡️ Security

  | Pattern | Protection |
  |---------|------------|
  | `sql.ident(name)` | Escapes identifiers: `user` → `"user"` |
  | `sql.literal(value)` | Escapes string literals |
  | Parameter binding | Uses native `$1, $2` placeholders |
  | Template tags | Cannot be injected via user input |

  ```typescript
  // ✅ Safe - parameterized
  await pool.query`SELECT * FROM users WHERE name = ${userInput}`

  // ⚠️ Unsafe - raw interpolation (DON'T DO THIS)
  await pool.query(`SELECT * FROM users WHERE name = '${userInput}'`)

  // ✅ Safe - identifiers
  await pool.query`SELECT * FROM ${sql.ident(tableName)}`
  ```

  ---

  ## 📊 Null & Undefined Handling

  | Value | In INSERT | In UPDATE | In VALUES | In Arrays |
  |-------|-----------|-----------|-----------|-----------|
  | `null` | `NULL` | `NULL` | `NULL` | `NULL` |
  | `undefined` | `DEFAULT` | Skipped | `Error` | `Error` |


  ```typescript
  // undefined becomes DEFAULT
  await pool.query`
    INSERT INTO users ${sql.insert({ 
      name: 'Alice', 
      age: undefined,  // → DEFAULT
      email: null      // → NULL
    })}
  `
  // INSERT INTO users (name, age, email) VALUES ($1, DEFAULT, $2)

  // undefined fields are skipped in UPDATE
  await pool.query`
    UPDATE users SET ${sql.update({ 
      name: 'Bob',
      age: undefined   // Skipped - age remains unchanged
    })} WHERE id = 1
  `
  // UPDATE users SET name = $1 WHERE id = 1
  ```

  ---

  ## 🔧 API Reference

  ###  Connection 
  ```typescript
  class Connection {
      static new(params: ConnectionParams): Promise<Connection>

      query<T>(strings: TemplateStringsArray, ...values: any[]): Future<T[], PostgresError>
      begin<T>(callback: (tx: Transaction) => Promise<T>): Future<T, Error>
      notify(channelName: string, payload?: string): Future<[], PostgresError>
      listen(channelName: string, callback: (payload: string) => void): Future<[], PostgresError>
      unlisten(channelName: string, callback: (payload: string) => void): Future<[], PostgresError>

      get isAlive(): boolean
      close(): void
  }

  interface ConnectionParams {
      user: string
      password?: string
      host: string
      port: number
      database: string
      logLevel?: 'none' | 'error' | 'notice' | 'query' // defaul: "error"
  }
  ```

  ### Pool

  ```typescript
  class Pool {
      constructor(config: PoolConfig)

      query<T>(strings: TemplateStringsArray, ...values: any[]): Future<T[], Error>
      begin<T>(callback: (tx: Transaction) => Promise<T>): Future<T, Error>
      notify(channelName: string, payload?: string): Future<[], PostgresError>
      acquire(): Future<Connection, Error>
      release(conn: Connection): void
      close(): void

      get size(): number
      get total(): number
  }

  interface PoolConfig extends ConnectionParams {
      max?: number
  }
  ```

  ### Transaction

  ```typescript
  class Transaction {
    query<T>(strings: TemplateStringsArray, ...values: any[]): Future<T[], PostgresError>
    commit(): Future<[], PostgresError>
    rollback(): Future<[], PostgresError>
    savepoint<T>(name: string, callback: (tx: Transaction) => Promise<T>): Future<T, Error>

    get isActive(): boolean
  }
  ```

  ### **sql** helper
  ```typescript
  const sql: {
    ident<T extends string>(identificator: T): IdentifierClause<T>
    literal<T extends string>(value: T): LiteralClause<T>
    fragment(strings: TemplateStringsArray, ...values: any[]): FragmentClause
    insert<T extends Record<string, any>>(...objects: NoInfer<T>[]): InsertClause<T>
    update<T extends Record<string, any>>(object: T): UpdateClause<T>
    where<T extends Record<string, any>>(whereMap: T): WhereClause<T>
    excluded(fields: string[]): ExcludeUpdateClause
    array(array: any[], separator?: string): ArrayClause
    empty: EmptyClause
  }
  ```

  ---


  Pgtx is a PostgreSQL driver.

  It is not an ORM. It is absolutely Blazing.

  ## 📝 License

  MIT © [M2K-5F](https://github.com/M2K-5F)

  ---

  **Made with ❤️ and a bit of insanity**
