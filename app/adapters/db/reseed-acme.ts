import { resolveSmokeTenantPasswords, targetsProductionData } from '#core/domain/index.js';

import { createDb } from './client.js';
import { reseedMarkers } from './reseed-guard.js';
import { runSmokeTenantReseed } from './smoke-tenant-reseed.js';
import { DEMO_SEED_PASSWORD } from './smoke-tenant-seed.js';

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgres://together:together@localhost:48912/together';

const resolved = resolveSmokeTenantPasswords({
  production: targetsProductionData(
    reseedMarkers({ ...process.env, DATABASE_URL: connectionString }),
  ),
  demoPassword: DEMO_SEED_PASSWORD,
  configured: {
    member: process.env['SMOKE_MEMBER_PASSWORD'],
    creator: process.env['SMOKE_CREATOR_PASSWORD'],
  },
});
if (!resolved.ok) {
  console.error(`Smoke tenant reseed refused because ${resolved.reason}`);
  process.exit(1);
}

const summary = await runSmokeTenantReseed(
  createDb('node-postgres', connectionString),
  { passwords: resolved.passwords, nowIso: () => new Date().toISOString() },
);

console.log(`Smoke tenant wiped and reseeded (${summary.tenantId}):`);
for (const entry of summary.wiped) {
  if (entry.rows > 0) console.log(`  ${entry.table}: ${entry.rows} rows`);
}
console.log(`  creator  ${summary.seed.creator.email}  ->  ${summary.seed.creator.tenantSlug}`);
for (const member of summary.seed.members) {
  console.log(`  member   ${member.email}  ->  ${member.tenantId}`);
}
process.exit(0);
