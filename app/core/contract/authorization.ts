import { z } from 'zod';

import {
  CAPABILITIES,
  PRINCIPALS,
  type Capability,
  type Identity,
  type Principal,
} from '#core/domain/index.js';

export { CAPABILITIES, PRINCIPALS };

export const capabilitySchema = z.enum(CAPABILITIES);
export const principalSchema = z.enum(PRINCIPALS);
export const capabilityMatrixSchema = z.record(
  principalSchema,
  z.array(capabilitySchema).readonly(),
);

export type CapabilityMatrix = Record<Principal, readonly Capability[]>;

const sharedStaffCapabilities = [
  'tenant:list-own',
  'tenant:settings:read',
  'tenant:secret:read',
  'tenant:onboarding:read',
  'tenant:onboarding:write',
  'product:read',
  'product:write',
  'product:publish',
  'product:access:read',
  'product:access:write',
  'product:price:read',
  'product:price:write',
  'member:read',
  'member:export',
  'member:remove',
  'member:grant:read',
  'member:grant:write',
  'member:learning:read',
  'member:progress:read',
  'member:progress:manage',
  'api-key:read',
  'course:read',
  'course:write',
  'course:history:read',
  'community:read',
  'community:write',
  'community:moderate',
  'space:read',
  'space:write',
  'notification:read',
  'notification:write',
  'order:read',
  'order:export',
  'sales:read',
  'invoice:read',
  'invoice:write',
  'coupon:read',
  'coupon:write',
  'coupon:report',
  'marketing:consent:read',
  'marketing:consent:write',
  'marketing:campaign:read',
  'marketing:campaign:write',
  'marketing:campaign:send',
  'marketing:message:read',
  'marketing:message:send',
  'marketing:document:read',
  'marketing:document:write',
  'marketing:layout:read',
  'marketing:layout:write',
  'marketing:ses:read',
  'marketing:ses:write',
  'marketing:suppression:read',
  'marketing:suppression:write',
  'marketing:delivery:read',
  'marketing:reputation:read',
  'scheduler:read',
] as const satisfies readonly Capability[];

const ownerOnlyCapabilities = [
  'tenant:settings:write',
  'tenant:secret:write',
  'api-key:write',
  'integration:test',
] as const satisfies readonly Capability[];

const matrix = {
  owner: [...sharedStaffCapabilities, ...ownerOnlyCapabilities],
  admin: sharedStaffCapabilities,
  member: [
    'tenant:list-own',
    'tenant:settings:read',
    'member:progress:self-write',
    'member:billing:read',
    'member:product:read',
    'lesson:play',
    'community:read',
    'community:write',
    'space:read',
    'notification:read',
    'notification:write',
    'invoice:member-read',
  ],
  authenticated: ['tenant:create', 'tenant:list-own'],
  'api-key': [
    'marketing:consent:read',
    'marketing:consent:write',
    'marketing:message:read',
    'marketing:message:send',
    'marketing:layout:read',
    'marketing:suppression:read',
    'marketing:suppression:write',
  ],
  'operator-secret': ['scheduler:read', 'scheduler:dispatch'],
  webhook: ['webhook:process'],
  token: ['marketing:consent:read', 'marketing:consent:write'],
  public: [
    'health:read',
    'auth:use',
    'marketing:consent:write',
    'marketing:document:read',
    'checkout:read',
    'checkout:start',
    'offer:read',
    'legal:read',
  ],
} as const satisfies CapabilityMatrix;

capabilityMatrixSchema.parse(matrix);

export const ROLE_CAPABILITIES: CapabilityMatrix = matrix;

export const principalForIdentity = (identity: Identity): Principal => {
  if (identity.staffRole === 'owner') return 'owner';
  if (identity.staffRole === 'admin') return 'admin';
  if (identity.memberId !== null) return 'member';
  return 'authenticated';
};

export const capabilitiesForPrincipal = (principal: Principal): readonly Capability[] =>
  ROLE_CAPABILITIES[principal];

export const capabilitiesForIdentity = (identity: Identity): readonly Capability[] =>
  capabilitiesForPrincipal(principalForIdentity(identity));
