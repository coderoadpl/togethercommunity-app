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
  capabilitySchema,
  z.array(principalSchema).readonly(),
);

export type CapabilityMatrix = Record<Capability, readonly Principal[]>;

const staff = ['owner', 'admin'] as const satisfies readonly Principal[];
const staffAndMember = ['owner', 'admin', 'member'] as const satisfies readonly Principal[];
const humans = ['owner', 'admin', 'member', 'authenticated'] as const satisfies readonly Principal[];
const publicOnly = ['public'] as const satisfies readonly Principal[];
const staffAndApiKey = ['owner', 'admin', 'api-key'] as const satisfies readonly Principal[];

const matrix = {
  'health:read': publicOnly,
  'auth:use': publicOnly,
  'tenant:create': ['authenticated'],
  'tenant:list-own': humans,
  'tenant:settings:read': staffAndMember,
  'tenant:settings:write': ['owner'],
  'tenant:secret:read': staff,
  'tenant:secret:write': ['owner'],
  'tenant:onboarding:read': staff,
  'tenant:onboarding:write': staff,
  'product:read': staff,
  'product:write': staff,
  'product:publish': staff,
  'product:access:read': staff,
  'product:access:write': staff,
  'product:price:read': staff,
  'product:price:write': staff,
  'member:read': staff,
  'member:export': staff,
  'member:remove': staff,
  'member:grant:read': staff,
  'member:grant:write': staff,
  'member:learning:read': staff,
  'member:progress:read': staff,
  'member:progress:write': [...staff, 'member'],
  'member:billing:read': ['member'],
  'member:product:read': ['member'],
  'api-key:read': staff,
  'api-key:write': staff,
  'course:read': staff,
  'course:write': staff,
  'course:history:read': staff,
  'lesson:play': ['member'],
  'community:read': staffAndMember,
  'community:write': staffAndMember,
  'community:moderate': staff,
  'space:read': staffAndMember,
  'space:write': staff,
  'notification:read': staffAndMember,
  'notification:write': staffAndMember,
  'order:read': staff,
  'order:export': staff,
  'sales:read': staff,
  'invoice:read': staff,
  'invoice:write': staff,
  'coupon:read': staff,
  'coupon:write': staff,
  'coupon:report': staff,
  'integration:test': staff,
  'marketing:consent:read': [...staffAndApiKey, 'token'],
  'marketing:consent:write': [...staffAndApiKey, 'token', 'public'],
  'marketing:campaign:read': staff,
  'marketing:campaign:write': staff,
  'marketing:campaign:send': staff,
  'marketing:message:read': staffAndApiKey,
  'marketing:message:send': staffAndApiKey,
  'marketing:document:read': [...staff, 'public'],
  'marketing:document:write': staff,
  'marketing:layout:read': [...staff, 'api-key'],
  'marketing:layout:write': staff,
  'marketing:ses:read': staff,
  'marketing:ses:write': staff,
  'marketing:suppression:read': staffAndApiKey,
  'marketing:suppression:write': staffAndApiKey,
  'marketing:delivery:read': staff,
  'marketing:reputation:read': staff,
  'scheduler:read': [...staff, 'operator-secret'],
  'scheduler:dispatch': ['operator-secret'],
  'checkout:read': publicOnly,
  'checkout:start': publicOnly,
  'offer:read': publicOnly,
  'legal:read': publicOnly,
  'webhook:process': ['webhook'],
} as const satisfies CapabilityMatrix;

capabilityMatrixSchema.parse(matrix);

export const CAPABILITY_MATRIX: CapabilityMatrix = matrix;

export const principalForIdentity = (identity: Identity): Principal => {
  if (identity.staffRole === 'owner') return 'owner';
  if (identity.staffRole === 'admin') return 'admin';
  if (identity.memberId !== null) return 'member';
  return 'authenticated';
};

export const capabilitiesForPrincipal = (principal: Principal): readonly Capability[] =>
  CAPABILITIES.filter((capability) => CAPABILITY_MATRIX[capability].includes(principal));

export const capabilitiesForIdentity = (identity: Identity): readonly Capability[] =>
  capabilitiesForPrincipal(principalForIdentity(identity));
