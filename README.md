## Pgtx 🚀

[![Tests](https://github.com/M2K-5F/pgtx/actions/workflows/tests.yaml/badge.svg)](https://github.com/M2K-5F/pgtx/actions/workflows/tests.yaml)

A lightweight, **high-performance** SQL query builder for `node-postgres` (pg).  
Experience ORM-like convenience (auto-inserts, updates, recursive fragments) with the transparency and speed of raw SQL.

---

## 📦 Installation

```bash
npm install @m2k-5f/pgtx
# or
yarn add @m2k-5f/pgtx
# or
pnpm add @m2k-5f/pgtx
# or 
bun add @m2k-5f/pgtx
```
## 🔥 Why Pgtx?

---

*   **Zero-Cost Abstraction**: Only ~2% - 0% overhead compared to raw `pg.query`.
*   **Structural Caching**: Uses `WeakMap` to cache SQL templates. Static parts are parsed only once.
*   **Explicit Prepared Statements**: Create and reuse prepared statements with type safety
*   **True Recursion**: Nest `sql.fragment` anywhere. Argument numbering ($1, $2) is managed automatically across all nesting levels.
*   **No Magic**: You write SQL, `Pgtx` handles the tedious parts (placeholders, identifiers, bulk inserts).
*   **ACID Transactions**: Reliable transaction management with automatic rollback on errors.

---

## 🚀 Quick Start

```typescript
import { sql, Pool } from "@m2k-5f/pgtx";

const pool = new Pool({ /* pg.PoolConfig */ })

// Type-safe query with automatic placeholder ($1)
const [user] = await pool.query<User>`SELECT * FROM users WHERE id = ${1}`
```

---



## ⚡ Performance Benchmark

The following results were measured during sequential execution of 2000 complex `UPSERT` queries.


| Tool | RPS | Avg. Query Time | Performance Overhead |
| :--- | :---: | :---: | :---: |
| **Native `pg.query`** | **~209** | **4.791ms** | **0% (Baseline)** |
| **Pgtx** | **~207** | **4.827ms** | **0.76%(zero-cost)** |
| Typical Node.js ORM | **~58** | 12.5+ ms | > 150% |


## 📖 Feature Guide

### 1. Recursive Fragments (sql.fragment)
Combine multiple SQL pieces. Perfect for dynamic filters or subqueries.

```typescript
const filter = sql.fragment`status = ${'active'} AND age > ${21}`
const roleSub = sql.fragment`(SELECT id FROM roles WHERE name = ${'admin'})`

await pool.query`
  INSERT INTO users (name, role_id) 
  VALUES (${'Ivan'}, (${roleSub}))
  WHERE ${filter}
`
// SQL: INSERT INTO users ... VALUES ($1, (SELECT id FROM roles WHERE name = $2)) WHERE status = $3 AND age > $4
```

### 2. Transactions
Automatic BEGIN, COMMIT, and ROLLBACK. Use savepoint for nested logic.

```typescript
await pool.begin(async (tx) => {
    await tx.query`UPDATE accounts SET balance = balance - 100 WHERE id = 1`;
    
    // Nested transaction (Savepoint)
    let err = await tx.savepoint('inventory', async (stx) => {
        await stx.query`UPDATE stock SET count = count - 1 WHERE item_id = ${42}`;
        if (outOfStock) throw new Error(); // Only 'inventory' rolls back
    });
    if (err) {
      // Handle error
      // tx still active & can be commited
    }
});
// Main transaction commits or rolls back based on callback success
```

### 3. Bulk Inserts (sql.insert)
Automatically extracts columns from the first object. Supports single objects and arrays.

```typescript
const users = [
  { name: 'Alice', email: 'alice@test.com' },
  { name: 'Bob', email: 'bob@test.com' }
]

await pool.query`INSERT INTO users ${sql.insert(users)}`
// SQL: INSERT INTO users (name, email) VALUES ($1, $2), ($3, $4)
```
#### 3.1 UPSERT Helper (sql.excluded)
Perfect for ON CONFLICT clauses to avoid re-typing column names.

```typescript
await pool.query`
  INSERT INTO users ${sql.insert(data)}
  ON CONFLICT (id) DO UPDATE 
  SET ${sql.excluded(['name', 'email', 'updated_at'])}
`
// SQL: ... SET name = EXCLUDED.name, email = EXCLUDED.email, updated_at = EXCLUDED.updated_at
```

### 4. Prepared Statements
Pre-parse SQL on the database server for maximum performance in hot loops.

```typescript
const stmt = await pool.prepare<User, [string]>("get_user_by_email", 'SELECT * FROM users WHERE email = ?')
// `Pgtx` automatically maps standard `?` placeholders to native `$1, $2` indexes.

const users = await stmt.execute('test@example.com')
// Statements created via pool.prepare are lazily initialized on each connection upon first use,
// gradually "warming up" the entire pool for peak performance.
```

### 5. Smart Lists (sql.array)
The ultimate tool for dynamic lists. Works for IN clauses, column lists, or joined conditions.

```typescript
// 1. Classic IN clause
const ids = [10, 20]
await pool.query`SELECT * FROM users WHERE id IN (${sql.array(ids)})`
// SQL: SELECT * FROM users WHERE id IN ($1, $2)

// 2. Dynamic column list
const cols = [sql.ident('id'), sql.ident('name')]
await pool.query`SELECT ${sql.array(cols)} FROM users`
// SQL: SELECT "id", "name" FROM users

// 3. Dynamic WHERE conditions
const conds = [sql.fragment`active = true`, sql.fragment`age > ${18}`]
await pool.query`SELECT * FROM users WHERE ${sql.array(conds, ' AND ')}`
// SQL: SELECT * FROM users WHERE active = true AND age > $1
```

### 6. Dynamic Updates (sql.update)
Easily generate SET clauses from plain JavaScript objects. 

```typescript
const data = { status: 'pro', last_login: new Date() }

await pool.query`UPDATE users SET ${sql.update(data)} WHERE id = ${1}`
// SQL: UPDATE users SET status = $1, last_login = $2 WHERE id = $3
```

### 7. Clean Filtering (sql.where)
Generates AND-separated conditions from an object. Skips undefined values for easy dynamic filtering.

```typescript
const filters = { role: 'admin', age: undefined, active: true };
await pool.query`SELECT * FROM users WHERE ${sql.where(filters)}`
// SQL: SELECT * FROM users WHERE role = $1 AND active = $2
```

### 8. Conditional Logic (sql.empty)
A safe "no-op" fragment for cleaner ternary operations in templates.

```typescript
const search = "";
await pool.query`
  SELECT * FROM posts 
  ${search ? sql.fragment`WHERE title ILIKE ${search}` : sql.empty}
`
// Result if empty: SELECT * FROM posts
```
---

## 🔄 Null & Undefined Handling

Pgtx treats `null` and `undefined` differently to match SQL semantics and JavaScript expectations:

| Value | In INSERT | In UPDATE | In VALUES/Parameters | In Arrays |
|-------|-----------|-----------|----------------------|-----------|
| `null` | `NULL` | `NULL` | `NULL` | `NULL` |
| `undefined` | `DEFAULT` | Field skipped | Error | Error |

### Examples

```typescript
// INSERT: undefined becomes DEFAULT
await pool.query`
  INSERT INTO users ${sql.insert({ 
    name: 'Alice', 
    age: undefined,  // -> DEFAULT
    email: null      // -> NULL
  })}
`
// SQL: INSERT INTO users (name, age, email) VALUES ($1, DEFAULT, $2)

// UPDATE: undefined fields are skipped
await pool.query`
  UPDATE users SET ${sql.update({ 
    name: 'Bob',
    age: undefined,  // skipped - age remains unchanged
    deleted_at: null // explicitly set to NULL
  })} WHERE id = 1
`
// SQL: UPDATE users SET name = $1, deleted_at = $2 WHERE id = 1

// Arrays: undefined throw
sql.array([1, undefined, 3]) // ❌ TypeError(`Array item at index 1 is undefined`)

// Empty arrays throw (use [null] for NULL result)
sql.array([]) // ❌ Error: Array clause is empty. Use sql.array([null])...
```

## 🛡️ Security
*    **SQL Injection**: Automatically uses native placeholders ($1, $2) for all values.
*    **Identifiers**: `sql.ident` escapes names (e.g., user -> "user") to prevent conflicts with SQL keywords and identifier injection.
*    **Connection Leaks**: `pool.begin` and `pool.query` use `try...finally` internally. Prepared statements created via Pool also automatically release connections.
