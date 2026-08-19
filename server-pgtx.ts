import { createServer } from 'node:http';
import { Pool, sql } from '@m2k-5f/pgtx';
import { Ok } from 'fluent-future';
import { ErrQueryTimeout } from './dist/error';

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5433,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'pgtx_test',
  max: Number(process.env.PGMAX) || 10,
});

interface User {
  id: number
  name: string
  balance: number
}

const server = createServer(async (req, res) => {
  if (req.url === '/users') {
    let counter = 0
    const base = Math.floor(Math.random() * 1000) + 1
    const targetIds = Array.from({ length: 5 }, (_, i) => (base < 950 ? base : 950) + i).sort((a,b)=>a-b)
    

    const users = await pool.query<User>`
      SELECT id, name, balance 
      FROM bench_users 
      WHERE id = ANY(${targetIds})
      order by id
    `.orElse(err => {
      console.log(err)
      
      return Ok(null)
    })

    
    if (!users) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Error' }))
      return
    }

    for (const user of users) {
      if (user.id !== targetIds[counter++]) {
        console.log(users, targetIds);
        
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Id mismatch' }))
        return
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(users))
    return
  }

  res.writeHead(404)
  res.end()
});

server.listen(3000, () => {
  console.log('Pgtx Server running on http://localhost:3000');
});

