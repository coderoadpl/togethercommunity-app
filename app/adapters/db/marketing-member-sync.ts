import { and, eq, isNull, lte } from 'drizzle-orm';

import type { MarketingMemberSyncRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { marketingMemberSyncJobs as jobs, members } from './schema.js';

export const createMarketingMemberSyncRepository = (db: Db): MarketingMemberSyncRepository => ({
  next: async (tenantId, now) => {
    const [row] = await db.select({ memberId: jobs.memberId, revision: jobs.revision, email: members.email, displayName: members.displayName }).from(jobs).innerJoin(members, and(eq(members.tenantId, jobs.tenantId), eq(members.id, jobs.memberId))).where(and(eq(jobs.tenantId, tenantId), eq(jobs.status, 'pending'), lte(jobs.nextAttemptAt, now), isNull(members.deletedAt))).orderBy(jobs.updatedAt, jobs.memberId).limit(1);
    return row ?? null;
  },
  complete: async (tenantId, memberId, revision, now) => (await db.update(jobs).set({ status: 'completed', updatedAt: now, lockedBy: null, lockedUntil: null }).where(and(eq(jobs.tenantId, tenantId), eq(jobs.memberId, memberId), eq(jobs.revision, revision))).returning()).length === 1,
});
