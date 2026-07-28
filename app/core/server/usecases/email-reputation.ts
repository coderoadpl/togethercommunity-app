import {
  deriveEmailReputation,
  emailReputationSchema,
  err,
  forbidden,
  ok,
  reputationWindow,
  type AppError,
  type EmailReputation,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { Clock, EmailEventRepository } from '../ports.js';

const staffTenantIdFrom = (ctx: Ctx): Result<string, AppError> =>
  ctx.identity.tenantId === null || ctx.identity.staffRole === null
    ? err(forbidden('Tenant staff access is required'))
    : ok(ctx.identity.tenantId);

export const getEmailReputation = async (
  ctx: Ctx,
  deps: { events: EmailEventRepository; clock: Clock },
): Promise<Result<EmailReputation, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx);
  if (!tenantId.ok) return err(tenantId.error);
  const window = reputationWindow(deps.clock.nowIso());
  const counts = await deps.events.reputationCounts(tenantId.value, window);
  return ok(emailReputationSchema.parse({
    windowStart: window.since,
    windowEnd: window.until,
    ...deriveEmailReputation(counts),
  }));
};
