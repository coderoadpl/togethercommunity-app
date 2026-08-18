import { describe, expect, it } from 'vitest';

import type { Identity } from '#core/domain/index.js';

import { authorize, authorizeRequiredTenant, authorizeTenant } from './authorize.js';

const identity = (tenantId: string | null): Identity => ({
  userId: 'user-1',
  email: 'person@example.test',
  name: 'Person',
  emailVerified: true,
  tenantId,
  tenantSlug: tenantId === null ? null : 'tenant',
  tenantName: tenantId === null ? null : 'Tenant',
  staffRole: 'owner',
  memberId: null,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
});

describe('authorize', () => {
  it('derives capabilities from the caller identity', () => {
    expect(authorize({ identity: identity('tenant-1') }, 'product:read')).toBeNull();
    expect(authorize({ identity: { ...identity('tenant-1'), staffRole: 'admin' } }, 'integration:test')).toEqual({
      code: 'forbidden',
      message: 'integration:test is not permitted',
    });
  });

  it('allows only a capability declared on the context', () => {
    const ctx = { identity: identity('tenant-1'), capabilities: ['product:read'] as const };
    expect(authorize(ctx, 'product:read')).toBeNull();
    expect(authorize(ctx, 'product:write')).toEqual({
      code: 'forbidden',
      message: 'product:write is not permitted',
    });
  });

  it('preserves a membership grant on an identity that also carries a staff role', () => {
    const dualIdentity = { ...identity('tenant-1'), memberId: 'member-1' };
    expect(authorize({ identity: dualIdentity }, 'member:billing:read')).toBeNull();
    expect(authorize({ identity: identity('tenant-1') }, 'member:billing:read')).toMatchObject({
      code: 'forbidden',
    });
  });

  it('withholds only tenant:create from an unverified granted principal', () => {
    const unverified = { ...identity(null), emailVerified: false };
    expect(authorize({ identity: unverified }, 'tenant:create')).toEqual({
      code: 'forbidden',
      message: 'tenant:create requires a verified email address',
    });
    expect(authorize({ identity: unverified }, 'tenant:list-own')).toBeNull();
  });

  it('preserves principal denial before checking verification', () => {
    const unverified = { ...identity(null), emailVerified: false };
    expect(authorize({ identity: unverified, capabilities: [] }, 'tenant:create')).toEqual({
      code: 'forbidden',
      message: 'tenant:create is not permitted',
    });
  });
});

describe('authorizeTenant', () => {
  it('returns the tenant id after authorization', () => {
    expect(authorizeTenant(
      { identity: identity('tenant-1'), capabilities: ['product:read'] },
      'product:read',
    )).toEqual({ ok: true, value: 'tenant-1' });
  });

  it('preserves tenant scoping before capability denial', () => {
    expect(authorizeTenant({ identity: identity(null), capabilities: [] }, 'product:read')).toMatchObject({
      ok: false,
      error: { code: 'tenant_not_found' },
    });
  });

  it('returns tenant_not_found for a permitted tenantless context', () => {
    expect(authorizeTenant(
      { identity: identity(null), capabilities: ['tenant:create'] },
      'tenant:create',
    )).toMatchObject({
      ok: false,
      error: { code: 'tenant_not_found' },
    });
  });
});

describe('authorizeRequiredTenant', () => {
  it('preserves forbidden for a tenantless caller denied the capability', () => {
    expect(
      authorizeRequiredTenant({ identity: identity(null) }, 'marketing:delivery:read'),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('preserves forbidden for a capable tenantless caller', () => {
    expect(
      authorizeRequiredTenant(
        { identity: identity(null), capabilities: ['marketing:consent:write'] },
        'marketing:consent:write',
      ),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
