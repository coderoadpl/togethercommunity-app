import { and, asc, eq, or, sql, type SQL } from 'drizzle-orm';

import { entitlementKeySchema, type EntitlementKey } from '#core/domain/index.js';
import type { EntitlementKeyRateLimitRepository, EntitlementKeyRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { entitlementKeyRateLimitBuckets, entitlementKeys } from './schema.js';
import { insertShopManagementKeyEvent } from './shop-management-key-events.js';

const parseKey = (key: unknown): EntitlementKey => entitlementKeySchema.parse(key);

const withoutKeyHashInErrors = async <T>(message: string, query: () => PromiseLike<T>): Promise<T> => {
  try {
    return await query();
  } catch {
    // The driver error and its cause carry the bound key hash, which must never reach telemetry, logs or a response.
    throw new Error(message);
  }
};

export const createEntitlementKeyRepository = (db: Db): EntitlementKeyRepository => ({
  listByTenant: async (tenantId) =>
    (
      await db
        .select()
        .from(entitlementKeys)
        .where(eq(entitlementKeys.tenantId, tenantId))
        .orderBy(asc(entitlementKeys.createdAt), asc(entitlementKeys.id))
    ).map(parseKey),
  create: async (tenantId, key, event) => {
    const parsed = parseKey(key);
    if (parsed.tenantId !== tenantId) throw new Error('Entitlement key belongs to another tenant');
    await withoutKeyHashInErrors('API key write failed', () => db.transaction(async (tx) => {
      await tx.insert(entitlementKeys).values(parsed);
      await insertShopManagementKeyEvent(tx, tenantId, event);
    }));
  },
  findByHash: async (tenantId, keyHash) => {
    const rows = await withoutKeyHashInErrors('API key lookup failed', () => db
      .select()
      .from(entitlementKeys)
      .where(and(eq(entitlementKeys.tenantId, tenantId), eq(entitlementKeys.keyHash, keyHash)))
      .limit(1));
    const row = rows[0];
    return row ? parseKey(row) : null;
  },
  revoke: async (tenantId, id, revokedAt, event) => db.transaction(async (tx) => {
    const rows = await tx
      .update(entitlementKeys)
      .set({ revokedAt })
      .where(and(
        eq(entitlementKeys.tenantId, tenantId),
        eq(entitlementKeys.id, id),
        sql`${entitlementKeys.revokedAt} is null`,
      ))
      .returning();
    const row = rows[0];
    if (!row) return null;
    await insertShopManagementKeyEvent(tx, tenantId, event);
    return parseKey(row);
  }),
});

const ownsKey = async (db: Db, tenantId: string, apiKeyId: string): Promise<boolean> => {
  const [owned] = await db
    .select({ id: entitlementKeys.id })
    .from(entitlementKeys)
    .where(and(eq(entitlementKeys.tenantId, tenantId), eq(entitlementKeys.id, apiKeyId)))
    .limit(1);
  return owned !== undefined;
};

const storedWindowIsOlder = (windowStartedAt: string): SQL =>
  sql`${entitlementKeyRateLimitBuckets.windowStartedAt} < ${windowStartedAt}::timestamptz`;

export const createEntitlementKeyRateLimitRepository = (db: Db): EntitlementKeyRateLimitRepository => ({
  claim: async (tenantId, input) => {
    if (input.limit < 1 || input.weight < 1 || input.weight > input.limit || !await ownsKey(db, tenantId, input.apiKeyId)) return false;
    const [row] = await db.insert(entitlementKeyRateLimitBuckets).values({
      apiKeyId: input.apiKeyId,
      period: input.period,
      windowStartedAt: input.windowStartedAt,
      count: input.weight,
    }).onConflictDoUpdate({
      target: [entitlementKeyRateLimitBuckets.apiKeyId, entitlementKeyRateLimitBuckets.period],
      set: {
        windowStartedAt: sql`greatest(${entitlementKeyRateLimitBuckets.windowStartedAt}, ${input.windowStartedAt}::timestamptz)`,
        count: sql`case when ${storedWindowIsOlder(input.windowStartedAt)} then ${input.weight}::integer else ${entitlementKeyRateLimitBuckets.count} + ${input.weight}::integer end`,
      },
      setWhere: or(
        storedWindowIsOlder(input.windowStartedAt),
        sql`${entitlementKeyRateLimitBuckets.count} + ${input.weight}::integer <= ${input.limit}`,
      ) ?? sql`false`,
    }).returning({ count: entitlementKeyRateLimitBuckets.count });
    return row !== undefined;
  },
  release: async (tenantId, input) => {
    if (!await ownsKey(db, tenantId, input.apiKeyId)) return;
    await db
      .update(entitlementKeyRateLimitBuckets)
      .set({ count: sql`greatest(0, ${entitlementKeyRateLimitBuckets.count} - ${input.weight}::integer)` })
      .where(and(
        eq(entitlementKeyRateLimitBuckets.apiKeyId, input.apiKeyId),
        eq(entitlementKeyRateLimitBuckets.period, input.period),
        eq(entitlementKeyRateLimitBuckets.windowStartedAt, input.windowStartedAt),
      ));
  },
});
