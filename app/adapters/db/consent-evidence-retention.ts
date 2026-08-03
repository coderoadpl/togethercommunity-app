import { and, eq, lt } from 'drizzle-orm';

import type { ConsentEvidenceRetentionRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { consents, marketingConsents } from './schema.js';

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
  purgeExpired: async (tenantId, retentionStartedBefore) => db.transaction(async (tx) => {
    const marketing = await tx.delete(marketingConsents).where(and(
      eq(marketingConsents.tenantId, tenantId),
      lt(marketingConsents.retentionStartedAt, retentionStartedBefore),
    )).returning({ id: marketingConsents.id });
    const terms = await tx.delete(consents).where(and(
      eq(consents.tenantId, tenantId),
      lt(consents.retentionStartedAt, retentionStartedBefore),
    )).returning({ id: consents.id });
    return marketing.length + terms.length;
  }),
});
