import {
  deriveEmailReputation,
  emailReputationSchema,
  err,
  ok,
  reputationWindow,
  type AppError,
  type EmailReputation,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type { Clock, EmailEventRepository } from '../ports.js';

export const getEmailReputation = async (
  ctx: Ctx,
  deps: { events: EmailEventRepository; clock: Clock },
): Promise<Result<EmailReputation, AppError>> => {
  const tenantId = authorizeTenant(ctx, 'marketing:reputation:read');
  if (!tenantId.ok) return err(tenantId.error);
  const window = reputationWindow(deps.clock.nowIso());
  const counts = await deps.events.reputationCounts(tenantId.value, window);
  return ok(emailReputationSchema.parse({
    windowStart: window.since,
    windowEnd: window.until,
    ...deriveEmailReputation(counts),
  }));
};
