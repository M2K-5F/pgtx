import { createServer } from 'node:http';
import { Pool, sql } from '@m2k-5f/pgtx';
import { count } from 'node:console';

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5433,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'pgtx_test',
  max: Number(process.env.PGMAX) || 10
});

interface User {
  id: number;
  name: string;
  balance: number;
}

const server = createServer(async (req, res) => {
  if (req.url === '/users') {
    let counter = 0
    const i = Math.floor(Math.random() * 1000) + 1
    const ids = Array.from({length: 5}, (_, j) => (i % 1000) + 1 + j).sort((a, b) => a - b)

    const users = await pool.query<User>`
      SELECT id, name, balance FROM bench_users WHERE id in (${sql.array(ids)}) order by id
    `
    .catch((err) => {
      return [null]
    })

    if (!users[0]) {
      res.writeHead(504, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Timeout' }))
      return
    }
    
    for (const user of users) {
      if (user!.id !== ids[counter++]) {
        console.log(users, ids);
        
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Ужасающе' }))
        return
      }
    }

    

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(users))
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(3000, () => {
  console.log('Pgtx Server running on http://localhost:3000')
})
