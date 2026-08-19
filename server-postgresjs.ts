import { createServer } from 'node:http';
import postgres from 'postgres';

const sql = postgres({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5433,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'pgtx_test',
  max: Number(process.env.PGMAX) || 10
});

const server = createServer(async (req, res) => {
  if (req.url === '/users') {
    let counter = 0
    const base = Math.floor(Math.random() * 1000) + 1
    const targetIds = Array.from({ length: 5 }, (_, i) => (base < 950 ? base : 950) + i).sort((a,b)=>a-b)

    const users = await sql`
      SELECT id, name, balance 
      FROM bench_users 
      WHERE id = ANY(${targetIds})
      order by id
    `.catch(err => {
      console.log(err)
      
      return null
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

server.listen(3001, () => {
  console.log('Postgres.js Server running on http://localhost:3000');
});
