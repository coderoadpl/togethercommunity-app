import { storageCorsProbeResultSchema, type StorageCorsCacheEntry } from '#core/domain/index.js';
import type { StorageCorsCache } from '#core/server/index.js';

import type { Db } from '../db/client.js';
import { storageCorsChecks } from '../db/schema.js';

const toEntry = (row: typeof storageCorsChecks.$inferSelect): StorageCorsCacheEntry => ({
  checkedAt: new Date(row.checkedAt).toISOString(),
  results: storageCorsProbeResultSchema.array().parse(row.results),
});

export const createStorageCorsCache = (db: Db): StorageCorsCache => ({
  read: async (tenantId) => {
    const row = await db.query.storageCorsChecks.findFirst({
      where: (checks, { eq }) => eq(checks.tenantId, tenantId),
    });
    return row === undefined ? null : toEntry(row);
  },
  write: async (tenantId, entry) => {
    await db.insert(storageCorsChecks).values({
      tenantId,
      checkedAt: entry.checkedAt,
      results: entry.results,
    }).onConflictDoUpdate({
      target: storageCorsChecks.tenantId,
      set: { checkedAt: entry.checkedAt, results: entry.results },
    });
  },
});
