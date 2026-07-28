import { z } from 'zod';

import {
  CAPABILITIES,
  PRINCIPALS,
  ROLE_CAPABILITIES,
  capabilitiesForPrincipal,
  type Capability,
  type Identity,
  type Principal,
} from '#core/domain/index.js';

export {
  CAPABILITIES,
  PRINCIPALS,
  ROLE_CAPABILITIES,
  capabilitiesForPrincipal,
};

export const capabilitySchema = z.enum(CAPABILITIES);
export const principalSchema = z.enum(PRINCIPALS);
export const capabilityMatrixSchema = z.record(
  principalSchema,
  z.array(capabilitySchema).readonly(),
);

capabilityMatrixSchema.parse(ROLE_CAPABILITIES);

export const principalForIdentity = (identity: Identity): Principal => {
  if (identity.staffRole === 'owner') return 'owner';
  if (identity.staffRole === 'admin') return 'admin';
  if (identity.memberId !== null) return 'member';
  return 'authenticated';
};

export const capabilitiesForIdentity = (identity: Identity): readonly Capability[] =>
  capabilitiesForPrincipal(principalForIdentity(identity));
