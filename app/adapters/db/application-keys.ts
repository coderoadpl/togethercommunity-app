import { and, asc, eq, or, sql, type SQL } from 'drizzle-orm';

import { applicationKeySchema, storedApplicationKeySchema, type ApplicationKey } from '#core/domain/index.js';
import type { ApplicationKeyRateLimitRepository, ApplicationKeyRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { applicationKeyRateLimitBuckets, applicationKeys } from './schema.js';
import { insertShopManagementKeyEvent } from './shop-management-key-events.js';

const parseNewKey = (key: ApplicationKey): ApplicationKey => applicationKeySchema.parse(key);

const parseStoredKey = (row: unknown): ApplicationKey => storedApplicationKeySchema.parse(row);

const withoutKeyHashInErrors = async <T>(message: string, query: () => PromiseLike<T>): Promise<T> => {
  try {
    return await query();
  } catch {
    // The driver error and its cause carry the bound key hash, which must never reach telemetry, logs or a response.
    throw new Error(message);
  }
};

export const createApplicationKeyRepository = (db: Db): ApplicationKeyRepository => ({
  listByTenant: async (tenantId) =>
    (
      await db
        .select()
        .from(applicationKeys)
        .where(eq(applicationKeys.tenantId, tenantId))
        .orderBy(asc(applicationKeys.createdAt), asc(applicationKeys.id))
    ).map(parseStoredKey),
  create: async (tenantId, key, event) => {
    const parsed = parseNewKey(key);
    if (parsed.tenantId !== tenantId) throw new Error('Application key belongs to another tenant');
    await withoutKeyHashInErrors('API key write failed', () => db.transaction(async (tx) => {
      await tx.insert(applicationKeys).values(parsed);
      await insertShopManagementKeyEvent(tx, tenantId, event);
    }));
  },
  findByHash: async (tenantId, keyHash) => {
    const rows = await withoutKeyHashInErrors('API key lookup failed', () => db
      .select()
      .from(applicationKeys)
      .where(and(eq(applicationKeys.tenantId, tenantId), eq(applicationKeys.keyHash, keyHash)))
      .limit(1));
    const row = rows[0];
    return row ? parseStoredKey(row) : null;
  },
  revoke: async (tenantId, id, revokedAt, event) => db.transaction(async (tx) => {
    const rows = await tx
      .update(applicationKeys)
      .set({ revokedAt })
      .where(and(
        eq(applicationKeys.tenantId, tenantId),
        eq(applicationKeys.id, id),
        sql`${applicationKeys.revokedAt} is null`,
      ))
      .returning();
    const row = rows[0];
    if (!row) return null;
    await insertShopManagementKeyEvent(tx, tenantId, event);
    return parseStoredKey(row);
  }),
});

const ownsKey = async (db: Db, tenantId: string, apiKeyId: string): Promise<boolean> => {
  const [owned] = await db
    .select({ id: applicationKeys.id })
    .from(applicationKeys)
    .where(and(eq(applicationKeys.tenantId, tenantId), eq(applicationKeys.id, apiKeyId)))
    .limit(1);
  return owned !== undefined;
};

const storedWindowIsOlder = (windowStartedAt: string): SQL =>
  sql`${applicationKeyRateLimitBuckets.windowStartedAt} < ${windowStartedAt}::timestamptz`;

export const createApplicationKeyRateLimitRepository = (db: Db): ApplicationKeyRateLimitRepository => ({
  claim: async (tenantId, input) => {
    if (input.limit < 1 || input.weight < 1 || input.weight > input.limit || !await ownsKey(db, tenantId, input.apiKeyId)) return false;
    const [row] = await db.insert(applicationKeyRateLimitBuckets).values({
      apiKeyId: input.apiKeyId,
      period: input.period,
      windowStartedAt: input.windowStartedAt,
      count: input.weight,
    }).onConflictDoUpdate({
      target: [applicationKeyRateLimitBuckets.apiKeyId, applicationKeyRateLimitBuckets.period],
      set: {
        windowStartedAt: sql`greatest(${applicationKeyRateLimitBuckets.windowStartedAt}, ${input.windowStartedAt}::timestamptz)`,
        count: sql`case when ${storedWindowIsOlder(input.windowStartedAt)} then ${input.weight}::integer else ${applicationKeyRateLimitBuckets.count} + ${input.weight}::integer end`,
      },
      setWhere: or(
        storedWindowIsOlder(input.windowStartedAt),
        sql`${applicationKeyRateLimitBuckets.count} + ${input.weight}::integer <= ${input.limit}`,
      ) ?? sql`false`,
    }).returning({ count: applicationKeyRateLimitBuckets.count });
    return row !== undefined;
  },
  release: async (tenantId, input) => {
    if (!await ownsKey(db, tenantId, input.apiKeyId)) return;
    await db
      .update(applicationKeyRateLimitBuckets)
      .set({ count: sql`greatest(0, ${applicationKeyRateLimitBuckets.count} - ${input.weight}::integer)` })
      .where(and(
        eq(applicationKeyRateLimitBuckets.apiKeyId, input.apiKeyId),
        eq(applicationKeyRateLimitBuckets.period, input.period),
        eq(applicationKeyRateLimitBuckets.windowStartedAt, input.windowStartedAt),
      ));
  },
});
