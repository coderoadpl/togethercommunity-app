import { describe, expect, it } from 'vitest';

import type { Identity } from '#core/domain/index.js';

import { authorize, authorizeTenant } from './authorize.js';

const identity = (tenantId: string | null): Identity => ({
  userId: 'user-1',
  email: 'person@example.test',
  name: 'Person',
  tenantId,
  tenantSlug: tenantId === null ? null : 'tenant',
  tenantName: tenantId === null ? null : 'Tenant',
  staffRole: 'owner',
  memberId: null,
});

describe('authorize', () => {
  it('denies when the context declares no capabilities', () => {
    expect(authorize({ identity: identity('tenant-1') }, 'product:read')).toEqual({
      code: 'forbidden',
      message: 'product:read is not permitted',
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
});

describe('authorizeTenant', () => {
  it('returns the tenant id after authorization', () => {
    expect(authorizeTenant(
      { identity: identity('tenant-1'), capabilities: ['product:read'] },
      'product:read',
    )).toEqual({ ok: true, value: 'tenant-1' });
  });

  it('denies before tenant scoping when the capability is absent', () => {
    expect(authorizeTenant({ identity: identity(null) }, 'product:read')).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
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
