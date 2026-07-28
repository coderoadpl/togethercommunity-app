import { describe, expect, it } from 'vitest';

import type { Identity } from '#core/domain/index.js';

import {
  CAPABILITIES,
  CAPABILITY_MATRIX,
  PRINCIPALS,
  capabilitiesForIdentity,
  capabilitiesForPrincipal,
  capabilityMatrixSchema,
  capabilitySchema,
  principalForIdentity,
  principalSchema,
} from './authorization.js';

const identity = (
  staffRole: Identity['staffRole'],
  memberId: string | null = null,
): Identity => ({
  userId: 'user-1',
  email: 'person@example.test',
  name: 'Person',
  tenantId: staffRole === null && memberId === null ? null : 'tenant-1',
  tenantSlug: staffRole === null && memberId === null ? null : 'tenant',
  tenantName: staffRole === null && memberId === null ? null : 'Tenant',
  staffRole,
  memberId,
});

describe('authorization contract', () => {
  it('parses the closed capability and principal enums', () => {
    expect(CAPABILITIES.map((capability) => capabilitySchema.parse(capability))).toEqual(CAPABILITIES);
    expect(PRINCIPALS.map((principal) => principalSchema.parse(principal))).toEqual(PRINCIPALS);
  });

  it('parses an exhaustive matrix row for every capability', () => {
    expect(capabilityMatrixSchema.parse(CAPABILITY_MATRIX)).toEqual(CAPABILITY_MATRIX);
    expect(Object.keys(CAPABILITY_MATRIX).sort()).toEqual([...CAPABILITIES].sort());
  });

  it('expands owner and admin roles without collapsing their owner-only difference', () => {
    expect(capabilitiesForPrincipal('owner')).toContain('tenant:settings:write');
    expect(capabilitiesForPrincipal('admin')).not.toContain('tenant:settings:write');
    expect(capabilitiesForPrincipal('owner')).toEqual(
      expect.arrayContaining([...capabilitiesForPrincipal('admin')]),
    );
  });

  it('keeps members, API keys, and public callers distinct', () => {
    expect(capabilitiesForPrincipal('member')).toContain('member:product:read');
    expect(capabilitiesForPrincipal('member')).not.toContain('member:read');
    expect(capabilitiesForPrincipal('api-key')).toContain('marketing:message:send');
    expect(capabilitiesForPrincipal('public')).toContain('offer:read');
    expect(capabilitiesForPrincipal('public')).not.toContain('tenant:settings:read');
  });

  it('derives the identity principal with staff taking precedence over membership', () => {
    expect(principalForIdentity(identity('owner', 'member-1'))).toBe('owner');
    expect(principalForIdentity(identity('admin'))).toBe('admin');
    expect(principalForIdentity(identity(null, 'member-1'))).toBe('member');
    expect(principalForIdentity(identity(null))).toBe('authenticated');
    expect(capabilitiesForIdentity(identity('admin'))).toEqual(capabilitiesForPrincipal('admin'));
  });
});
