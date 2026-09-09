import { err, ok, appError, normalizeEmail, type AppError, type Result } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeRequiredTenant } from '../authorize.js';
import type { MarketingContactDeps } from '../marketing-contact-ports.js';

export const syncMarketingMemberContacts = async (ctx: Ctx, input: { deadlineAt: string; maxJobs: number }, deps: MarketingContactDeps): Promise<Result<{ processed: number; pending: boolean }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'scheduler:dispatch');
  if (!tenant.ok) return tenant;
  let processed = 0;
  while (processed < input.maxJobs && deps.clock.nowIso() < input.deadlineAt) {
    const job = await deps.memberSync.next(tenant.value, deps.clock.nowIso());
    if (job === null) return ok({ processed, pending: false });
    const result = await deps.transaction.run(tenant.value, async (repos) => {
      const existing = await repos.contacts.findByEmail(tenant.value, normalizeEmail(job.email));
      await repos.contacts.upsertByEmail(tenant.value, { email: normalizeEmail(job.email), ...(existing === null ? { displayName: job.displayName, source: 'member' } : {}) });
      return await repos.memberSync.complete(tenant.value, job.memberId, job.revision, deps.clock.nowIso()) ? ok(true) : err(appError('conflict', 'Member changed during directory synchronization'));
    });
    if (!result.ok) return result;
    processed += 1;
  }
  return ok({ processed, pending: await deps.memberSync.next(tenant.value, deps.clock.nowIso()) !== null });
};
