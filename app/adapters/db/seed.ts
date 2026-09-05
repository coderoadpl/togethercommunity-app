import { targetsProductionData } from '#core/domain/index.js';

import { createDb } from './client.js';
import { reseedMarkers } from './reseed-guard.js';
import { applySeed, printSeedSummary } from './seed-data.js';

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgres://together:together@localhost:48912/together';

const markers = reseedMarkers({ ...process.env, DATABASE_URL: connectionString });
if (targetsProductionData(markers)) {
  console.error('Seed refused: the demo fixtures must never reach a production database');
  process.exit(1);
}

printSeedSummary(await applySeed(createDb('node-postgres', connectionString)));
process.exit(0);
