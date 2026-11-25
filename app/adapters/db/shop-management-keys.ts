import { and, asc, eq, or, sql, type SQL } from 'drizzle-orm';

import { shopManagementKeySchema, type ShopManagementKey } from '#core/domain/index.js';
import type { ShopManagementKeyRateLimitRepository, ShopManagementKeyRepository } from '#core/server/index.js';

import { deleteEmptyGroupsOfKey } from './change-proposal-groups.js';
import { withdrawPendingChangeProposalsOfKey } from './change-proposals.js';
import type { Db } from './client.js';
import { lockSmokeFixture } from './smoke-fixture-lock.js';
import { shopManagementKeyRateLimitBuckets, shopManagementKeys } from './schema.js';
import { insertShopManagementKeyEvent } from './shop-management-key-events.js';

const parseKey = (key: typeof shopManagementKeys.$inferSelect): ShopManagementKey => shopManagementKeySchema.parse({
  ...key,
  purpose: key.purpose ?? undefined,
  ...(key.purpose === 'purchase-smoke' ? { scopes: [], expiresAt: key.purposeExpiresAt } : {}),
});

const withoutKeyHashInErrors = async <T>(message: string, query: () => PromiseLike<T>): Promise<T> => {
  try {
    return await query();
  } catch {
    // The driver error and its cause carry the bound key hash, which must never reach telemetry, logs or a response.
    throw new Error(message);
  }
};

export const createShopManagementKeyRepository = (db: Db): ShopManagementKeyRepository => ({
  listByTenant: async (tenantId) =>
    (
      await db
        .select()
        .from(shopManagementKeys)
        .where(eq(shopManagementKeys.tenantId, tenantId))
        .orderBy(asc(shopManagementKeys.createdAt), asc(shopManagementKeys.id))
    ).map(parseKey),
  create: async (tenantId, key, event) => {
    const parsed = shopManagementKeySchema.parse(key);
    if (parsed.tenantId !== tenantId) throw new Error('Shop management key belongs to another tenant');
    await withoutKeyHashInErrors('API key write failed', () => db.transaction(async (tx) => {
      await lockSmokeFixture(tx, tenantId);
      // Old releases must parse the row but refuse even a transformed secret, so the legacy expiry stays permanently in the past.
      await tx.insert(shopManagementKeys).values(parsed.purpose === 'purchase-smoke' ? {
        ...parsed, scopes: ['shop:catalog:read'], expiresAt: '1970-01-01T00:00:00.000Z', purposeExpiresAt: parsed.expiresAt,
      } : parsed);
      await insertShopManagementKeyEvent(tx, tenantId, event);
    }));
  },
  findByHash: async (tenantId, keyHash) => {
    const rows = await withoutKeyHashInErrors('API key lookup failed', () => db
      .select()
      .from(shopManagementKeys)
      .where(and(eq(shopManagementKeys.tenantId, tenantId), eq(shopManagementKeys.keyHash, keyHash)))
      .limit(1));
    const row = rows[0];
    return row ? parseKey(row) : null;
  },
  revoke: async (tenantId, id, revokedAt, event, withdrawal) => db.transaction(async (tx) => {
    await lockSmokeFixture(tx, tenantId);
    const rows = await tx
      .update(shopManagementKeys)
      .set({ revokedAt })
      .where(and(
        eq(shopManagementKeys.tenantId, tenantId),
        eq(shopManagementKeys.id, id),
        sql`${shopManagementKeys.revokedAt} is null`,
      ))
      .returning();
    const row = rows[0];
    if (!row) return null;
    await withdrawPendingChangeProposalsOfKey(tx, tenantId, row.id, 'keyRevoked', withdrawal);
    await deleteEmptyGroupsOfKey(tx, tenantId, row.id);
    await insertShopManagementKeyEvent(tx, tenantId, event);
    return parseKey(row);
  }),
  purge: async (tenantId, event, withdrawal) => db.transaction(async (tx) => {
    await lockSmokeFixture(tx, tenantId);
    const purged = await tx
      .delete(shopManagementKeys)
      .where(eq(shopManagementKeys.tenantId, tenantId))
      .returning({ id: shopManagementKeys.id });
    for (const { id } of purged) {
      await withdrawPendingChangeProposalsOfKey(tx, tenantId, id, 'keyPurged', withdrawal);
      await deleteEmptyGroupsOfKey(tx, tenantId, id);
    }
    for (const { id } of purged) await insertShopManagementKeyEvent(tx, tenantId, event(id));
    return purged.length;
  }),
});

const ownsKey = async (db: Db, tenantId: string, apiKeyId: string): Promise<boolean> => {
  const [owned] = await db
    .select({ id: shopManagementKeys.id })
    .from(shopManagementKeys)
    .where(and(eq(shopManagementKeys.tenantId, tenantId), eq(shopManagementKeys.id, apiKeyId)))
    .limit(1);
  return owned !== undefined;
};

// A late request of an earlier window counts against the stored newer window, so the newest window keeps its limit and a boundary race never rewinds it.
const storedWindowIsOlder = (windowStartedAt: string): SQL =>
  sql`${shopManagementKeyRateLimitBuckets.windowStartedAt} < ${windowStartedAt}::timestamptz`;

export const createShopManagementKeyRateLimitRepository = (db: Db): ShopManagementKeyRateLimitRepository => ({
  claim: async (tenantId, input) => db.transaction(async (tx) => {
    await lockSmokeFixture(tx, tenantId);
    if (input.limit < 1 || !await ownsKey(tx, tenantId, input.apiKeyId)) return false;
    const [row] = await tx.insert(shopManagementKeyRateLimitBuckets).values({
      apiKeyId: input.apiKeyId,
      period: input.period,
      windowStartedAt: input.windowStartedAt,
      count: 1,
    }).onConflictDoUpdate({
      target: [shopManagementKeyRateLimitBuckets.apiKeyId, shopManagementKeyRateLimitBuckets.period],
      set: {
        windowStartedAt: sql`greatest(${shopManagementKeyRateLimitBuckets.windowStartedAt}, ${input.windowStartedAt}::timestamptz)`,
        count: sql`case when ${storedWindowIsOlder(input.windowStartedAt)} then 1 else ${shopManagementKeyRateLimitBuckets.count} + 1 end`,
      },
      setWhere: or(
        storedWindowIsOlder(input.windowStartedAt),
        sql`${shopManagementKeyRateLimitBuckets.count} + 1 <= ${input.limit}`,
      ) ?? sql`false`,
    }).returning({ count: shopManagementKeyRateLimitBuckets.count });
    return row !== undefined;
  }),
  release: async (tenantId, input) => db.transaction(async (tx) => {
    await lockSmokeFixture(tx, tenantId);
    if (!await ownsKey(tx, tenantId, input.apiKeyId)) return;
    await tx
      .update(shopManagementKeyRateLimitBuckets)
      .set({ count: sql`greatest(0, ${shopManagementKeyRateLimitBuckets.count} - 1)` })
      .where(and(
        eq(shopManagementKeyRateLimitBuckets.apiKeyId, input.apiKeyId),
        eq(shopManagementKeyRateLimitBuckets.period, input.period),
        eq(shopManagementKeyRateLimitBuckets.windowStartedAt, input.windowStartedAt),
      ));
  }),
});
