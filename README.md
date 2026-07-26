## 🚀 Pgtx

[![Tests](https://github.com/M2K-5F/pgtx/actions/workflows/tests.yaml/badge.svg)](https://github.com/M2K-5F/pgtx/actions/workflows/tests.yaml)
[![npm version](https://img.shields.io/npm/v/@m2k-5f/pgtx.svg)](https://www.npmjs.com/package/@m2k-5f/pgtx)

**Blazing-fast PostgreSQL driver** with pipeline support.  
Zero deps, pure TypeScript.

---

## 📦 Installation

```bash
npm install @m2k-5f/pgtx
# yarn add @m2k-5f/pgtx
# pnpm add @m2k-5f/pgtx
# bun add @m2k-5f/pgtx
```

---

## ⚡ Performance

**2000 concurrent UPSERT queries, 150 concurrency, connection pool:**

| Tool | RPS | Avg Time | Connections |
|------|-----|----------|-------------|
| **Pgtx** | **1584** | **0.631ms** | **20 pool connections (pipeline multiplexing)** |
| Native `pg` | 179 | 5.585ms | 20 pool connections |

**Up to 9x faster in concurrent pipeline workloads**

**Pgtx achieves higher throughput by multiplexing concurrent queries over PostgreSQL connections using pipeline execution.**


> Benchmark source available in the [repository](https://github.com/M2K-5F/pgtx).

---

## ✨ Features

- **Pipeline queries** — 9x faster than `pg`
- **Tagged templates** — Natural SQL with type safety
- **Transactions & Savepoints** — Nested transactions with rollback
- **Bulk inserts** — Auto-extract columns from objects
- **Dynamic updates** — Generate SET clauses from objects
- **Recursive fragments** — Compose SQL like Lego
- **Prepared statements** — Automatic prepared statement caching
- **Connection pool** — Auto-management connections with support for pipeline queries via the pool itself.
- **Zero dependencies** — Lightweight and blazing

---

## 🔥 Why Pgtx?

| Feature | Pgtx | pg | TypeORM | Prisma |
|---------|------|----|---------|--------|
| **Pipeline Queries** | ✅ | ❌ | ❌ | ❌ |
| **Tagged Templates** | ✅ | ❌ | ❌ | ❌ |
| **Transactions** | ✅ | ✅ | ✅ | ✅ |
| **Savepoints** | ✅ | ❌ | ✅ | ❌ |
| **Bulk Insert** | ✅ | ❌ | ✅ | ✅ |
| **Prepared Statements** | ✅ | ✅ | ✅ | ✅ |
| **TypeScript** | ✅ | ✅ | ✅ | ✅ |
| **Zero Dependencies** | ✅ | ❌ | ❌ | ❌ |
| **Connection Pool** | ✅ | ✅ | ✅ | ✅ |

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

## 📖 Features

### Transactions & Savepoints

```typescript
await pool.begin(async (tx) => {
  await tx.query`INSERT INTO orders (user_id) VALUES (${userId})`
  
  // err: Error | null
  const err = await tx.savepoint('update_stock', async (stx) => {
    await stx.query`UPDATE stock SET count = count - 1 WHERE product_id = ${productId}`
    if (outOfStock) throw new Error() // Only savepoint rolls back
  })
})
```

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

    query<T>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]>
    begin<T>(callback: (tx: Transaction) => Promise<T>): Promise<T>

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

    query<T>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]>
    begin<T>(callback: (tx: Transaction) => Promise<T>): Promise<T>
    acquire(): Promise<Connection>
    release(conn: Connection): void
    close(): Promise<void>

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
  query<T>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]>
  commit(): Promise<void>
  rollback(): Promise<void>
  savepoint<T>(name: string, callback: (tx: Transaction) => Promise<T>): Promise<T>

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

## 📝 License

MIT © [M2K-5F](https://github.com/M2K-5F)

---

**Made with ❤️ and a bit of insanity**
