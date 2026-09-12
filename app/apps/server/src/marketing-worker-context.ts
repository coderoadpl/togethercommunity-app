import { capabilitiesForPrincipal } from '#core/domain/index.js';
import type { Ctx } from '#core/server/index.js';

const workerIdentity = (tenantId: string) => ({
  userId: 'marketing-worker', email: 'worker@together.invalid', name: 'Marketing worker',
  emailVerified: true, image: null,
  tenantId, tenantSlug: null, tenantName: null, staffRole: null, memberId: null, memberDisplayName: null, memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
});

export const schedulerContext = (tenantId: string): Ctx => ({
  identity: workerIdentity(tenantId),
  capabilities: capabilitiesForPrincipal('operator-secret'),
});

export const snsWebhookContext = (tenantId: string): Ctx => ({
  identity: workerIdentity(tenantId),
  capabilities: capabilitiesForPrincipal('webhook'),
});
