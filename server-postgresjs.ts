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
    const targetId = Math.floor(Math.random() * 1000) + 1;

    const [user] = await sql`
      SELECT id, name, balance FROM bench_users WHERE id = ${targetId}
    `;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(user));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(3000, () => {
  console.log('Postgres.js Server running on http://localhost:3000');
});
