import { lt, sql } from 'drizzle-orm';

import type { ConsentEvidenceRetentionRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { consents, marketingConsents } from './schema.js';

const rowCount = (result: unknown): number => {
  if (typeof result !== 'object' || result === null || !('rowCount' in result)) {
    throw new Error('Consent evidence purge query did not return a row count');
  }
  if (result.rowCount !== null && typeof result.rowCount !== 'number') {
    throw new Error('Consent evidence purge query returned an invalid row count');
  }
  return result.rowCount ?? 0;
};

const purgeBatches = async (
  options: { batchSize: number; deadlineMs: number },
  deleteBatch: () => Promise<number>,
): Promise<number> => {
  let purged = 0;
  while (Date.now() < options.deadlineMs) {
    const deleted = await deleteBatch();
    purged += deleted;
    if (deleted < options.batchSize) break;
  }
  return purged;
};

export const createConsentEvidenceRetentionRepository = (
  db: Db,
): ConsentEvidenceRetentionRepository => ({
  listExpiredTenantIds: async (retentionStartedBefore) => {
    const [termsTenants, marketingTenants] = await Promise.all([
      db.selectDistinct({ tenantId: consents.tenantId })
        .from(consents)
        .where(lt(consents.retentionStartedAt, retentionStartedBefore)),
      db.selectDistinct({ tenantId: marketingConsents.tenantId })
        .from(marketingConsents)
        .where(lt(marketingConsents.retentionStartedAt, retentionStartedBefore)),
    ]);
    return [...new Set([...termsTenants, ...marketingTenants].map((row) => row.tenantId))].sort();
  },
  purgeExpired: async (tenantId, retentionStartedBefore, options) => {
    const marketing = await purgeBatches(options, async () => {
      const result = await db.execute(sql`
        WITH batch AS (
          SELECT ctid FROM ${marketingConsents}
          WHERE ${marketingConsents.tenantId} = ${tenantId}
            AND ${marketingConsents.retentionStartedAt} < ${retentionStartedBefore}
          LIMIT ${options.batchSize}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM ${marketingConsents}
        WHERE ctid IN (SELECT ctid FROM batch)
      `);
      return rowCount(result);
    });
    const terms = await purgeBatches(options, async () => {
      const result = await db.execute(sql`
        WITH batch AS (
          SELECT ctid FROM ${consents}
          WHERE ${consents.tenantId} = ${tenantId}
            AND ${consents.retentionStartedAt} < ${retentionStartedBefore}
          LIMIT ${options.batchSize}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM ${consents}
        WHERE ctid IN (SELECT ctid FROM batch)
      `);
      return rowCount(result);
    });
    return marketing + terms;
  },
});
