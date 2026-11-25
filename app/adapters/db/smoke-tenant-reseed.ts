import { and, eq, getTableName, inArray } from 'drizzle-orm';

import {
  SMOKE_TENANT_ID,
  SmokeTenantReseedRefused,
  smokeTenantReseedRefusal,
  type SmokeTenantPasswords,
} from '#core/domain/index.js';

import type { Db } from './client.js';
import { DEMO_TENANT_WIPE_TABLES, type DemoTenantWipeTable } from './reseed-wipe-tables.js';
import { createSeedUsers } from './seed-users.js';
import { applySmokeTenantSeed, type SmokeTenantSeedSummary } from './smoke-tenant-seed.js';
import { marketingConsents, members, tenants, shopManagementKeys, shopManagementKeyEvents, shopManagementKeyRateLimitBuckets, purchaseSmokeCheckouts, purchaseSmokeReceipts } from './schema.js';
import { lockSmokeFixture } from './smoke-fixture-lock.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RESTORE_BATCH_SIZE = 500;

export interface SmokeTenantReseedSummary {
  tenantId: string;
  wiped: Array<{ table: string; rows: number }>;
  seed: SmokeTenantSeedSummary;
}

export const runSmokeTenantReseed = async (
  db: Db,
  options: { passwords: SmokeTenantPasswords; purchaseFixtures?: boolean; nowIso: () => string },
): Promise<SmokeTenantReseedSummary> =>
  db.transaction(async (tx) => {
    await lockSmokeFixture(tx, SMOKE_TENANT_ID);

    const [tenant] = await tx
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, SMOKE_TENANT_ID))
      .limit(1);
    const memberRows = await tx
      .select({ email: members.email })
      .from(members)
      .where(eq(members.tenantId, SMOKE_TENANT_ID));
    const consentRows = await tx
      .selectDistinct({ email: marketingConsents.email })
      .from(marketingConsents)
      .where(eq(marketingConsents.tenantId, SMOKE_TENANT_ID));

    const refusal = smokeTenantReseedRefusal({
      tenant: tenant ?? null,
      memberEmails: memberRows.map((row) => row.email),
      consentEmails: consentRows.map((row) => row.email),
    });
    if (refusal !== null) {
      throw new SmokeTenantReseedRefused(`Smoke tenant reseed refused because ${refusal}`);
    }

    const keptKeyFilter = and(eq(shopManagementKeys.tenantId, SMOKE_TENANT_ID), eq(shopManagementKeys.purpose, 'purchase-smoke'));
    const keptKeys = await tx.select().from(shopManagementKeys).where(keptKeyFilter);
    const keyIds = tx.select({ id: shopManagementKeys.id }).from(shopManagementKeys).where(keptKeyFilter);
    const keptEvents = await tx.select().from(shopManagementKeyEvents).where(and(
      eq(shopManagementKeyEvents.tenantId, SMOKE_TENANT_ID), inArray(shopManagementKeyEvents.apiKeyId, keyIds),
    ));
    const keptLimits = await tx.select().from(shopManagementKeyRateLimitBuckets)
      .where(inArray(shopManagementKeyRateLimitBuckets.apiKeyId, keyIds));
    const keptCheckoutFilter = and(eq(purchaseSmokeCheckouts.tenantId, SMOKE_TENANT_ID), inArray(purchaseSmokeCheckouts.apiKeyId, keyIds));
    const keptCheckouts = await tx.select().from(purchaseSmokeCheckouts).where(keptCheckoutFilter);
    const references = tx.select({ reference: purchaseSmokeCheckouts.reference }).from(purchaseSmokeCheckouts).where(keptCheckoutFilter);
    const keptReceipts = await tx.select().from(purchaseSmokeReceipts).where(and(
      eq(purchaseSmokeReceipts.tenantId, SMOKE_TENANT_ID), inArray(purchaseSmokeReceipts.reference, references),
    ));

    const wiped: Array<{ table: string; rows: number }> = [];
    const wipeTenantTable = async (table: DemoTenantWipeTable): Promise<void> => {
      const rows = await tx
        .delete(table)
        .where(eq(table.tenantId, SMOKE_TENANT_ID))
        .returning({ tenantId: table.tenantId });
      wiped.push({ table: getTableName(table), rows: rows.length });
    };

    for (const table of DEMO_TENANT_WIPE_TABLES) {
      await wipeTenantTable(table);
    }

    const removedTenants = await tx
      .delete(tenants)
      .where(eq(tenants.id, SMOKE_TENANT_ID))
      .returning({ id: tenants.id });
    wiped.push({ table: getTableName(tenants), rows: removedTenants.length });

    const seedClock = { nowIso: options.nowIso };
    let sequence = 0;
    const seed = await applySmokeTenantSeed(tx, {
      users: createSeedUsers(tx, seedClock),
      passwords: options.passwords,
      purchaseFixtures: options.purchaseFixtures ?? false,
      nextIso: () => new Date(Date.parse(options.nowIso()) + sequence++ * 1000).toISOString(),
      relativeIso: (days) => new Date(Date.parse(options.nowIso()) + days * DAY_MS).toISOString(),
    });

    for (let offset = 0; offset < keptKeys.length; offset += RESTORE_BATCH_SIZE) {
      await tx.insert(shopManagementKeys).values(keptKeys.slice(offset, offset + RESTORE_BATCH_SIZE));
    }
    for (let offset = 0; offset < keptEvents.length; offset += RESTORE_BATCH_SIZE) {
      await tx.insert(shopManagementKeyEvents).values(keptEvents.slice(offset, offset + RESTORE_BATCH_SIZE));
    }
    for (let offset = 0; offset < keptLimits.length; offset += RESTORE_BATCH_SIZE) {
      await tx.insert(shopManagementKeyRateLimitBuckets).values(keptLimits.slice(offset, offset + RESTORE_BATCH_SIZE));
    }
    for (let offset = 0; offset < keptCheckouts.length; offset += RESTORE_BATCH_SIZE) {
      await tx.insert(purchaseSmokeCheckouts).values(keptCheckouts.slice(offset, offset + RESTORE_BATCH_SIZE));
    }
    for (let offset = 0; offset < keptReceipts.length; offset += RESTORE_BATCH_SIZE) {
      await tx.insert(purchaseSmokeReceipts).values(keptReceipts.slice(offset, offset + RESTORE_BATCH_SIZE));
    }
    return { tenantId: SMOKE_TENANT_ID, wiped, seed };
  });
