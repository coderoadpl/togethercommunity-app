import { and, eq, getTableName, inArray, notExists, notInArray } from 'drizzle-orm';

import { createDb } from './client.js';
import { DEMO_TENANT_WIPE_TABLES, type DemoTenantWipeTable } from './reseed-wipe-tables.js';
import { schedulerRuns, schedulerRunTenants, tenants } from './schema.js';

const DEMO_TENANT_IDS = ['tenant-studio', 'tenant-acme', 'tenant-akademia'];

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgres://together:together@localhost:48912/together';

const db = createDb('node-postgres', connectionString);

const wiped: Array<{ table: string; rows: number }> = [];
const record = (table: string, rows: unknown[]): void => {
  wiped.push({ table, rows: rows.length });
};

const nonDemoRunTenant = db
  .select({ id: schedulerRunTenants.id })
  .from(schedulerRunTenants)
  .where(and(
    eq(schedulerRunTenants.runId, schedulerRuns.id),
    notInArray(schedulerRunTenants.tenantId, DEMO_TENANT_IDS),
  ));

record(
  'scheduler_runs',
  await db
    .delete(schedulerRuns)
    .where(notExists(nonDemoRunTenant))
    .returning({ id: schedulerRuns.id }),
);

const wipeTenantTable = async (table: DemoTenantWipeTable): Promise<void> => {
  const rows = await db
    .delete(table)
    .where(inArray(table.tenantId, DEMO_TENANT_IDS))
    .returning({ tenantId: table.tenantId });
  record(getTableName(table), rows);
};

for (const table of DEMO_TENANT_WIPE_TABLES) {
  await wipeTenantTable(table);
}

record(
  'tenants',
  await db
    .delete(tenants)
    .where(inArray(tenants.id, DEMO_TENANT_IDS))
    .returning({ id: tenants.id }),
);

console.log(`Demo tenants wiped (${DEMO_TENANT_IDS.join(', ')}):`);
for (const entry of wiped) {
  if (entry.rows > 0) console.log(`  ${entry.table}: ${entry.rows} rows`);
}
console.log('Re-seeding...');

await import('./seed.js');
