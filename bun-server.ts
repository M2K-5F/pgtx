// server.ts - запускать через bun

import { sql, Pool } from '@m2k-5f/pgtx';
import postgres from 'postgres';

// ============================================================
// Конфиг БД
// ============================================================
const DB = {
  host: 'localhost',
  port: 5433,
  user: 'postgres',
  password: 'postgres',
  database: 'pgtx_test',
};

// ============================================================
// Драйверы (все три работают в Bun)
// ============================================================

// 1. Pgtx
const pgtx = new Pool({ ...DB, max: 20, syncShedule: 'Immediate' });

// 2. Postgres.js
const pg = postgres({ ...DB, max: 20 });

// 3. Bun.Sql (нативный)
const bunSql = new Bun.sql(DB);

// ============================================================
// Сервер
// ============================================================

const server = Bun.serve({
  port: 3000,

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname.slice(1);

    const json = (data: any, status = 200) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      let rows: any[] = [];

      switch (path) {
        case 'pgtx': {
          const result = await pgtx.query`
            SELECT id, name, balance 
            FROM bench_users 
            ORDER BY id 
            LIMIT 30
          `;
          rows = result;
          break;
        }

        case 'postgresjs': {
          const result = await pg`
            SELECT id, name, balance 
            FROM bench_users 
            ORDER BY id 
            LIMIT 30
          `;
          rows = result;
          break;
        }

        case 'bunsql': {
          const result = await bunSql`
            SELECT id, name, balance 
            FROM bench_users 
            ORDER BY id 
            LIMIT 30
          `;
          rows = result;
          break;
        }

        default:
          return json({
            drivers: ['pgtx', 'postgresjs', 'bunsql'],
            endpoints: {
              pgtx: '/pgtx',
              postgresjs: '/postgresjs',
              bunsql: '/bunsql',
            },
          });
      }

      return json({
        driver: path,
        count: rows.length,
        rows,
      });
    } catch (err: any) {
      return json({ error: err.message }, 500);
    }
  },
});

console.log(`✅ Bun server: http://localhost:${server.port}`);
console.log(`  /pgtx       - Pgtx driver`);
console.log(`  /postgresjs - Postgres.js driver`);
console.log(`  /bunsql     - Bun.Sql driver`);
console.log(`\n📊 wrk -t2 -c50 -d10s http://localhost:${server.port}/pgtx`);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  pgtx.close();
  pg.end();
  bunSql.close();
  server.stop();
  process.exit(0);
});