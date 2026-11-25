import { and, eq, getTableName, ne, sql } from 'drizzle-orm';

import {
  SMOKE_TENANT_ID,
  SMOKE_TENANT_PURCHASE_EMAIL,
  SMOKE_TENANT_PURCHASE_USER_ID,
  SmokeTenantReseedRefused,
  smokeTenantReseedRefusal,
  type SmokeTenantPasswords,
} from '#core/domain/index.js';

import type { Db } from './client.js';
import { DEMO_TENANT_WIPE_TABLES, type DemoTenantWipeTable } from './reseed-wipe-tables.js';
import { createSeedUsers } from './seed-users.js';
import {
  applySmokeTenantSeed,
  SMOKE_TENANT_PURCHASE_ADMIN_ID,
  type SmokeTenantSeedSummary,
} from './smoke-tenant-seed.js';
import {
  account,
  marketingConsents,
  members,
  passkey,
  session,
  tenantAdmins,
  tenants,
  twoFactor,
  user,
} from './schema.js';

/** Serverless instances can overlap, so every smoke-tenant reseed queues behind the same lock. */
const SMOKE_TENANT_RESEED_LOCK_KEY = 4_820_914;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SmokeTenantReseedSummary {
  tenantId: string;
  wiped: Array<{ table: string; rows: number }>;
  seed: SmokeTenantSeedSummary;
}

/**
 * Committed on its own so a later guard refusal or an unset purchase password
 * still takes back every way into the account other than the reseeded password.
 */
const revokePurchaseAccess = async (db: Db): Promise<void> =>
  db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SMOKE_TENANT_RESEED_LOCK_KEY})`);
    await tx.delete(session).where(eq(session.userId, SMOKE_TENANT_PURCHASE_USER_ID));
    await tx.delete(passkey).where(eq(passkey.userId, SMOKE_TENANT_PURCHASE_USER_ID));
    await tx.delete(twoFactor).where(eq(twoFactor.userId, SMOKE_TENANT_PURCHASE_USER_ID));
    await tx
      .delete(account)
      .where(and(eq(account.userId, SMOKE_TENANT_PURCHASE_USER_ID), ne(account.providerId, 'credential')));
    await tx
      .update(user)
      .set({ twoFactorEnabled: false })
      .where(eq(user.id, SMOKE_TENANT_PURCHASE_USER_ID));
    await tx
      .delete(tenantAdmins)
      .where(and(eq(tenantAdmins.tenantId, SMOKE_TENANT_ID), eq(tenantAdmins.id, SMOKE_TENANT_PURCHASE_ADMIN_ID)));
  });

export const runSmokeTenantReseed = async (
  db: Db,
  options: { passwords: SmokeTenantPasswords; nowIso: () => string },
): Promise<SmokeTenantReseedSummary> => {
  await revokePurchaseAccess(db);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SMOKE_TENANT_RESEED_LOCK_KEY})`);

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
    const purchaseEmailUsers = options.passwords.purchase === null
      ? []
      : await tx
        .select({ id: user.id })
        .from(user)
        .where(sql`lower(${user.email}) = ${SMOKE_TENANT_PURCHASE_EMAIL}`);

    const refusal = smokeTenantReseedRefusal({
      tenant: tenant ?? null,
      memberEmails: memberRows.map((row) => row.email),
      consentEmails: consentRows.map((row) => row.email),
      purchaseEmailUserIds: purchaseEmailUsers.map((row) => row.id),
    });
    if (refusal !== null) {
      throw new SmokeTenantReseedRefused(`Smoke tenant reseed refused because ${refusal}`);
    }

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
      nextIso: () => new Date(Date.parse(options.nowIso()) + sequence++ * 1000).toISOString(),
      relativeIso: (days) => new Date(Date.parse(options.nowIso()) + days * DAY_MS).toISOString(),
    });

    return { tenantId: SMOKE_TENANT_ID, wiped, seed };
  });
};
