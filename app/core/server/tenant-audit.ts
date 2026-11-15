import type { TenantAuditEventInput } from '#core/domain/index.js';

import type { Ctx } from './context.js';

export const tenantAuditActor = (
  ctx: Pick<Ctx, 'identity' | 'machineActor'>,
): Pick<TenantAuditEventInput, 'actorUserId' | 'actorEmail' | 'actorApiKeyId'> => ({
  actorUserId: ctx.identity.userId,
  actorEmail: ctx.identity.email,
  actorApiKeyId: ctx.machineActor?.apiKeyId ?? null,
});
