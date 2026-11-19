import { and, asc, eq, ne, or, sql } from 'drizzle-orm';

import { shopManagementKeySchema, type ShopManagementKey } from '#core/domain/index.js';
import type { ShopManagementKeyRateLimitRepository, ShopManagementKeyRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { shopManagementKeyRateLimitBuckets, shopManagementKeys } from './schema.js';
import { insertShopManagementKeyEvent } from './shop-management-key-events.js';

const parseKey = (key: ShopManagementKey): ShopManagementKey => shopManagementKeySchema.parse(key);

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
    const parsed = parseKey(key);
    if (parsed.tenantId !== tenantId) throw new Error('Shop management key belongs to another tenant');
    await withoutKeyHashInErrors('API key write failed', () => db.transaction(async (tx) => {
      await tx.insert(shopManagementKeys).values(parsed);
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
  revoke: async (tenantId, id, revokedAt, event) => db.transaction(async (tx) => {
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
    await insertShopManagementKeyEvent(tx, tenantId, event);
    return parseKey(row);
  }),
  purge: async (tenantId, event) => db.transaction(async (tx) => {
    const purged = await tx
      .delete(shopManagementKeys)
      .where(eq(shopManagementKeys.tenantId, tenantId))
      .returning({ id: shopManagementKeys.id });
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

export const createShopManagementKeyRateLimitRepository = (db: Db): ShopManagementKeyRateLimitRepository => ({
  claim: async (tenantId, input) => {
    if (input.limit < 1 || !await ownsKey(db, tenantId, input.apiKeyId)) return false;
    const [row] = await db.insert(shopManagementKeyRateLimitBuckets).values({
      apiKeyId: input.apiKeyId,
      period: input.period,
      windowStartedAt: input.windowStartedAt,
      count: 1,
    }).onConflictDoUpdate({
      target: [shopManagementKeyRateLimitBuckets.apiKeyId, shopManagementKeyRateLimitBuckets.period],
      set: {
        windowStartedAt: input.windowStartedAt,
        count: sql`case when ${shopManagementKeyRateLimitBuckets.windowStartedAt} = ${input.windowStartedAt}::timestamptz then ${shopManagementKeyRateLimitBuckets.count} + 1 else 1 end`,
      },
      setWhere: or(
        ne(shopManagementKeyRateLimitBuckets.windowStartedAt, input.windowStartedAt),
        sql`${shopManagementKeyRateLimitBuckets.count} + 1 <= ${input.limit}`,
      ) ?? sql`false`,
    }).returning({ count: shopManagementKeyRateLimitBuckets.count });
    return row !== undefined;
  },
  release: async (tenantId, input) => {
    if (!await ownsKey(db, tenantId, input.apiKeyId)) return;
    await db
      .update(shopManagementKeyRateLimitBuckets)
      .set({ count: sql`greatest(0, ${shopManagementKeyRateLimitBuckets.count} - 1)` })
      .where(and(
        eq(shopManagementKeyRateLimitBuckets.apiKeyId, input.apiKeyId),
        eq(shopManagementKeyRateLimitBuckets.period, input.period),
        eq(shopManagementKeyRateLimitBuckets.windowStartedAt, input.windowStartedAt),
      ));
  },
});
