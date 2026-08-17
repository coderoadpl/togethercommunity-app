import { describe, expect, it } from 'vitest';

import type { Identity } from '#core/domain/index.js';

import {
  CAPABILITIES,
  PRINCIPALS,
  ROLE_CAPABILITIES,
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
  memberBannedAt: string | null = null,
): Identity => ({
  userId: 'user-1',
  email: 'person@example.test',
  name: 'Person',
  emailVerified: true,
  tenantId: staffRole === null && memberId === null ? null : 'tenant-1',
  tenantSlug: staffRole === null && memberId === null ? null : 'tenant',
  tenantName: staffRole === null && memberId === null ? null : 'Tenant',
  staffRole,
  memberId,
  image: null,
  memberDisplayName: null,
  memberBannedAt,
});

describe('authorization contract', () => {
  it('parses the closed capability and principal enums', () => {
    expect(CAPABILITIES.map((capability) => capabilitySchema.parse(capability))).toEqual(CAPABILITIES);
    expect(PRINCIPALS.map((principal) => principalSchema.parse(principal))).toEqual(PRINCIPALS);
  });

  it('parses an exhaustive matrix row for every capability', () => {
    expect(capabilityMatrixSchema.parse(ROLE_CAPABILITIES)).toEqual(ROLE_CAPABILITIES);
    expect(Object.keys(ROLE_CAPABILITIES).sort()).toEqual([...PRINCIPALS].sort());
    expect(new Set(Object.values(ROLE_CAPABILITIES).flat())).toEqual(new Set(CAPABILITIES));
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
    expect(capabilitiesForPrincipal('api-key')).not.toContain('import:content-write');
    expect(capabilitiesForPrincipal('api-key')).not.toContain('import:users-write');
    expect(capabilitiesForPrincipal('import-content-api-key')).toEqual([
      'import:content-write',
      'import:validate',
    ]);
    expect(capabilitiesForPrincipal('import-users-api-key')).toEqual([
      'import:users-write',
      'import:validate',
    ]);
    expect(capabilitiesForPrincipal('public')).toContain('offer:read');
    expect(capabilitiesForPrincipal('public')).toContain('lesson:play');
    expect(capabilitiesForPrincipal('public')).not.toContain('tenant:settings:read');
  });

  it('covers every capability the non-human edges demand', () => {
    const demands = [
      ['api-key', [
        'marketing:message:read',
        'marketing:message:send',
        'marketing:consent:read',
        'marketing:consent:write',
        'marketing:suppression:write',
        'enrollment:create',
      ]],
      ['token', ['marketing:consent:read', 'marketing:consent:write']],
      ['webhook', ['webhook:process']],
      ['operator-secret', [
        'scheduler:dispatch',
        'scheduler:read',
        'marketing:campaign:dispatch',
        'marketing:message:send',
      ]],
    ] as const;

    for (const [principal, demandedCapabilities] of demands) {
      expect(capabilitiesForPrincipal(principal)).toEqual(
        expect.arrayContaining([...demandedCapabilities]),
      );
    }
  });

  it('derives the identity principal with staff taking precedence over membership', () => {
    expect(principalForIdentity(identity('owner', 'member-1'))).toBe('owner');
    expect(principalForIdentity(identity('admin'))).toBe('admin');
    expect(principalForIdentity(identity(null, 'member-1'))).toBe('member');
    expect(principalForIdentity(identity(null))).toBe('authenticated');
    expect(capabilitiesForIdentity(identity('admin'))).toEqual(capabilitiesForPrincipal('admin'));
  });
});
