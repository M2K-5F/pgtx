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
  - **Native Web Streams API** — Memory-efficient data streaming via `pool.stream()`
  - **Transactions & Savepoints** — Nested transactions with rollback
  - **Bulk inserts** — Auto-extract columns from objects
  - **Dynamic updates** — Generate SET clauses from objects
  - **Recursive fragments** — Compose SQL like Lego
  - **Prepared statements** — Automatic prepared statement caching
  - **Connection pool** — Auto-management connections with support for pipeline queries via the pool itself.
  - **Zero dependencies** — Lightweight and blazing

---

## ⚡ Performance

All benchmarks are executed on **GitHub Actions** (Ubuntu, 2 vCPUs) and are fully reproducible. Benchmark sources are included in this repository.

### 1. PostgreSQL Pipeline Stress Test

**3000 concurrent parameterized `SELECT` queries**

* Connection pool: **10 connections**
* Measured with **mitata**

| Driver                 |     Avg Time |       Relative Speed | Memory (p75) |
| :--------------------- | -----------: | -------------------: | -----------: |
| **Pgtx (Pipeline)**    | **24.18 ms** | **Baseline (1.00×)** |  **≈2.5 MB** |
| Postgres.js (Pipeline) |     83.36 ms |     **3.45× slower** |      ≈7.6 MB |
| node-postgres (`pg`)   |    377.95 ms |    **15.63× slower** |     ≈11.4 MB |

### 2. Real-World HTTP Throughput

Simple `node:http` server serving a PostgreSQL-backed endpoint.

Measured with:

```bash
wrk -t2 -c<N> -d10s http://localhost:3000/users
```

| Concurrent Connections |             Pgtx |  Postgres.js |   Speedup |
| ---------------------: | ---------------: | -----------: | --------: |
|                     50 |      5,272 req/s |  5,691 req/s |     0.93× |
|                    200 | **12,918 req/s** |  6,724 req/s | **1.92×** |
|                   1000 | **21,429 req/s** |  8,423 req/s | **2.54×** |
|                  10000 | **22,486 req/s** | 12,764 req/s | **1.76×** |

### Why is Pgtx fast?

Pgtx is engineered for **throughput**, not for minimizing the latency of individual queries.

Instead of optimizing a single request in isolation, Pgtx minimizes per-query overhead under sustained concurrent load by combining:

* Pipeline query multiplexing
* Synchronous PostgreSQL wire protocol encoding
* Batched socket writes
* Automatic prepared statement caching
* Prepared statement deduplication
* Row description caching
* Binary protocol support
* Zero-dependency implementation

As concurrency increases, these optimizations significantly reduce protocol overhead, allowing Pgtx to scale more efficiently than traditional PostgreSQL drivers.

In the `mitata` benchmark, Pgtx also demonstrated approximately **3× lower memory usage** than Postgres.js while processing the same workload, reducing allocation pressure and improving sustained throughput under heavy load.

> **Blazing** isn't just a tagline — it's backed by reproducible benchmarks.

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


  ### High-Performance Data Streaming (`pool.stream`)

  For heavy database lookups (exporting millions of rows, bulk reports, or large analytical dumps), memory accumulation is the ultimate killer of backend stability. Storing rows in a standard JavaScript array causes massive heap pollution and triggers blocking Garbage Collection spikes.

  Pgtx solves this at the protocol level by introducing `pool.stream()`, which bypasses row aggregation entirely and pipes rows transitively directly into a native Web **`ReadableStream`**.

  #### 1. Ultra-Low Memory Row Iteration
  You can consume database rows sequentially using standard `for await...of` syntax. Rows are processed and evicted from memory the moment they arrive from the network socket buffer.

  ```typescript
  interface HeavyLog { id: number; data: string; timestamp: Date; }

  const logStream = pool.stream<HeavyLog>`
    SELECT id, data, timestamp FROM application_logs WHERE level = ${'error'}
  `;

  for await (const log of logStream) {
    // Each log object is parsed on-the-fly and processed instantly.
    // Zero rows are accumulated in the internal driver state!
    console.log(`[${log.timestamp.toISOString()}] ${log.data}`);
  }
  ```

  #### 2. Streaming Directly to HTTP Responses (`Bun.serve`)
  Since Pgtx implements the standardized Web Streams API, you can bridge your database query directly into an HTTP response body with absolutely zero intermediate buffers.

  ```typescript
  import { Pool } from "@m2k-5f/pgtx";

  const pool = new Pool({ /* ... config ... */ });

  export default {
    port: 3000,
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/export/users") {
        // Synchronously returns a stream handle even if pool sockets are currently busy
        const userStream = pool.stream`SELECT id, email, profile_metadata FROM giant_user_table`;

        return new Response(userStream, {
          headers: {
            "Content-Type": "application/json",
            "Transfer-Encoding": "chunked",
          },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  };
  ```


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

  Pgtx natively handles PostgreSQL `LISTEN/NOTIFY` protocol messages asynchronously without interrupting the multiplexed query pipeline. It offers two distinct ways to subscribe: high-level pool-driven subscriptions and low-level connection pinning.

  #### 1. Sending a Notification
  Notifications are atomic and can be triggered directly from the `Pool` utilizing any available socket:
  ```typescript
  await pool.notify('user_events', JSON.stringify({ id: 42, action: 'signup' }))
  ```

  #### 2. High-Level Pool Subscription (Recommended)
  You can subscribe directly via the `Pool` instance. Pgtx will automatically borrow a dedicated connection from the pool, issue the `LISTEN` command, and seamlessly manage its lifecycle. 

  The method returns a lazy, async **unsubscribe function** that cleanly handles `UNLISTEN` and returns the connection to the pool when invoked.

  ```typescript
  const onEvent = (payload: string) => {
    console.log(`Received payload: ${payload}`)
  }

  // Automatically borrows a connection and sets up the listener
  const unsubscribe = await pool.listen('user_events', onEvent)

  // When the subscription is no longer needed (e.g., server shutdown):
  // It automatically sends UNLISTEN and releases the connection back to the pool!
  await unsubscribe()
  ```

  #### 3. Low-Level Connection Subscription (Stateful)
  If you need complete control over a specific PostgreSQL backend process, you can acquire an explicit `Connection` instance. This allows you to multiplex multiple callbacks onto a single channel seamlessly.

  ```typescript
  const conn = await pool.acquire()

  const onEvent = (payload: string) => {
    console.log(`Received payload: ${payload}`)
  }

  // Multiplexes multiple callbacks onto a single LISTEN command seamlessly
  await conn.listen('user_events', onEvent)
  await conn.listen('user_events', (data) => logToFile(data))

  // Cleans up callbacks (Sends UNLISTEN only when the channel has zero callbacks left)
  await conn.unlisten('user_events', onEvent)

  // ⚠️ Manual lifecycle management is strictly required for this pattern!
  // Do NOT release it back to the pool until you are completely done listening.
  this.release(conn)
  ```

  > ⚠️ **Architecture Note:** While `pool.notify` is a fire-and-forget atomic command, subscription states (`LISTEN`/`UNLISTEN`) are strictly tied to specific PostgreSQL backend processes. Using the high-level `pool.listen()` is strongly recommended for application code, as it encapsulates socket management into an elegant, leak-proof callback boundary.


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
      stream<T extends Record<string, any>>(templates: TemplateStringsArray, ...params: any[]): ReadableStream<T>
      get isAlive(): boolean
      close(): void
  }

  interface ConnectionParams {
      user: string
      password?: string
      host: string
      port: number
      database: string
      queryTimeout?: number // default: 30 srconds
      logLevel?: 'none' | 'error' | 'notice' | 'query' // default: "error"
  }
  ```

  ### Pool

  ```typescript
  class Pool {
      constructor(config: PoolConfig)

      query<T>(strings: TemplateStringsArray, ...values: any[]): Future<T[], PostgresError>
      begin<T>(callback: (tx: Transaction) => Promise<T>): Future<T, Error>
      notify(channelName: string, payload?: string): Future<[], PostgresError>
      listen(channel: string, callback: (payload: string) => void): Future<() => Promise<void>, PostgresError>
      stream<T extends Record<string, any>>(templates: TemplateStringsArray, ...args: any[]): ReadableStream<T>
      withAcquire<T>(fn: (conn: Connection) => Promise<T>): Future<T, Error>
      acquire(): Future<Connection, PostgresError>
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
