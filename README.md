# Pgtx 🚀

A lightweight, **high-performance** SQL query builder for `node-postgres` (pg) based on Tagged Templates.

## 🛠 Features

*   **Zero Overhead**: ~2% overhead compared to raw `pg.query`.
*   **Recursive Composition**: Nest `sql.fragment` within each other; argument numbering is handled automatically.
*   **Structural Caching**: Static SQL parts are cached via `WeakMap`.
*   **ACID Transactions**: Managed via safe callbacks.

---

## 🚀 Quick Start

```typescript
import { sql, Pool } from 'pgtx';

const pool = new Pool({
  host: 'localhost',
  user: 'postgres',
  database: 'my_db',
  port: 5432
});

// Simple query
const id = 1;
const [user] = await pool.query<User>`SELECT * FROM users WHERE id = ${id}`;
```

## 📖 Examples

### 1. Fragments (Recursive Subqueries)
The most powerful feature. Nest fragments anywhere, and $1, $2 will be numbered correctly.


```typescript 
const filter = sql.fragment`status = ${'active'} AND age > ${21}`;
const roleSub = sql.fragment`(SELECT id FROM roles WHERE name = ${'admin'})`;

await pool.query`
  INSERT INTO users (name, role_id) 
  VALUES (${'Ivan'}, ${roleSub})
  WHERE ${filter}
`;
```

### 2. Batch Inserts (sql.insert)
Columns are automatically extracted from the first object.

```typescript
const users = [
  { name: 'Alice', email: 'alice@test.com' },
  { name: 'Bob', email: 'bob@test.com' }
];

await pool.query`INSERT INTO users ${sql.insert(users)}`;
```

### 3. Dynamic Updates (sql.update)
Generates the SET clause from a JavaScript object.

```typescript
const data = { status: 'pro', last_login: new Date() };

await pool.query`
  UPDATE users 
  SET ${sql.update(data)} 
  WHERE id = ${1}
`;
```

### 4. Arrays & Identifiers
sql.array handles IN clauses, and sql.ident safely escapes table/column names.

```typescript
const table = 'users';
const ids = [10, 20, 30];

await pool.query`
  SELECT ${sql.ident('name')} 
  FROM ${sql.ident(table)} 
  WHERE id IN ${sql.array(ids)}
`;
// SQL: SELECT "name" FROM "users" WHERE id IN ($1, $2, $3)
```

### 5. Transactions
If the callback throws an error, ROLLBACK is triggered automatically.

```typescript
const result = await pool.begin(async (tx) => {
    await tx.query`UPDATE accounts SET balance = balance - 100 WHERE id = 1`;
    await tx.query`UPDATE accounts SET balance = balance + 100 WHERE id = 2`;
    
    const [sender] = await tx.query`SELECT balance FROM accounts WHERE id = 1`;
    if (sender.balance < 0) throw new Error("Insufficient funds"); 

    return "Success";
});
```
