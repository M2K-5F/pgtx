import { createServer } from 'node:http';
import { Pool } from '@m2k-5f/pgtx';

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5433,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'pgtx_test',
  max: Number(process.env.PGMAX) || 1
});

interface User {
  id: number;
  name: string;
  balance: number;
}

const server = createServer(async (req, res) => {
  if (req.url === '/users') {
    const targetId = Math.floor(Math.random() * 1000) + 1

    const [user] = await pool.query<User>`
      SELECT id, name, balance FROM bench_users WHERE id = ${targetId}
    `
    .catch((err) => {
      return [null]
    })

    if (!user) {
      res.writeHead(504, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Timeout' }))
      return
    }

    if (user.id !== targetId) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Ужасающе' }))
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(user))
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(3000, () => {
  console.log('Pgtx Server running on http://localhost:3000')
})
