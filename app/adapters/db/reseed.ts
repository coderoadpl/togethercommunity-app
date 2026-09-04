import { createDb } from './client.js';
import { reseedMarkers } from './reseed-guard.js';
import { runReseed } from './reseed-run.js';
import { printSeedSummary } from './seed-data.js';

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgres://together:together@localhost:48912/together';

const summary = await runReseed(
  createDb('node-postgres', connectionString),
  reseedMarkers({ ...process.env, DATABASE_URL: connectionString }),
);

console.log(`Demo tenants wiped (${summary.demoTenantIds.join(', ')}):`);
for (const entry of summary.wiped) {
  if (entry.rows > 0) console.log(`  ${entry.table}: ${entry.rows} rows`);
}
printSeedSummary(summary.seed);
process.exit(0);
