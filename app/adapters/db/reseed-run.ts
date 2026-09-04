import { and, eq, getTableName, inArray, notExists, notInArray, sql } from 'drizzle-orm';

import type { DeploymentResetMarkers } from '#core/domain/index.js';

import type { Db } from './client.js';
import { assertReseedAllowed } from './reseed-guard.js';
import { DEMO_TENANT_WIPE_TABLES, type DemoTenantWipeTable } from './reseed-wipe-tables.js';
import { applySeed, type SeedSummary } from './seed-data.js';
import { schedulerRuns, schedulerRunTenants, tenants } from './schema.js';

const DEMO_TENANT_IDS = ['tenant-studio', 'tenant-acme', 'tenant-akademia'];

/** Serverless instances can overlap, so every reseed queues behind the same lock. */
const RESEED_LOCK_KEY = 4_820_913;

export interface ReseedSummary {
  demoTenantIds: string[];
  wiped: Array<{ table: string; rows: number }>;
  seed: SeedSummary;
}

export const runReseed = async (
  db: Db,
  markers: DeploymentResetMarkers,
): Promise<ReseedSummary> => {
  assertReseedAllowed(markers);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${RESEED_LOCK_KEY})`);

    const wiped: Array<{ table: string; rows: number }> = [];
    const record = (table: string, rows: unknown[]): void => {
      wiped.push({ table, rows: rows.length });
    };

    const nonDemoRunTenant = tx
      .select({ id: schedulerRunTenants.id })
      .from(schedulerRunTenants)
      .where(and(
        eq(schedulerRunTenants.runId, schedulerRuns.id),
        notInArray(schedulerRunTenants.tenantId, DEMO_TENANT_IDS),
      ));

    record(
      'scheduler_runs',
      await tx
        .delete(schedulerRuns)
        .where(notExists(nonDemoRunTenant))
        .returning({ id: schedulerRuns.id }),
    );

    const wipeTenantTable = async (table: DemoTenantWipeTable): Promise<void> => {
      const rows = await tx
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
      await tx
        .delete(tenants)
        .where(inArray(tenants.id, DEMO_TENANT_IDS))
        .returning({ id: tenants.id }),
    );

    return { demoTenantIds: DEMO_TENANT_IDS, wiped, seed: await applySeed(tx) };
  });
};
