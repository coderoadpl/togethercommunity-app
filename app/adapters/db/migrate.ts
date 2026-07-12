import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgres://together:together@localhost:48912/together';

const pool = new pg.Pool({ connectionString });

await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
console.log('Migrations applied');
await pool.end();
