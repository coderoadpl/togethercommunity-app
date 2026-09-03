import { createDb } from './client.js';
import { applySeed, printSeedSummary } from './seed-data.js';

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgres://together:together@localhost:48912/together';

printSeedSummary(await applySeed(createDb('node-postgres', connectionString)));
process.exit(0);
