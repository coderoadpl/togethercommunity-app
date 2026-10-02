import { capabilitiesForPrincipal } from '#core/domain/index.js';
import type { Ctx } from '#core/server/index.js';

const workerIdentity = (tenantId: string | null) => ({
  userId: 'marketing-worker', email: 'worker@together.invalid', name: 'Marketing worker',
  emailVerified: true, image: null,
  tenantAccess: 'none' as const, tenantId, tenantSlug: null, tenantName: null, staffRole: null, memberId: null, memberDisplayName: null, memberBannedAt: null,
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

export const operatorContext = (): Ctx => ({
  identity: { ...workerIdentity(null), userId: 'operator-secret', email: 'operator@together.invalid', name: 'Instance operator' },
  capabilities: capabilitiesForPrincipal('operator-secret'),
});
