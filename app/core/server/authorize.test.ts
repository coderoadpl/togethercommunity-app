import { describe, expect, it } from 'vitest';

import type { Identity, ImpersonationPrincipal } from '#core/domain/index.js';

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
  memberLanguage: null,
  memberVideoAutoplay: false,
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

const subjectIdentity: Identity = {
  ...identity('tenant-1'),
  userId: 'user-2',
  email: 'member@example.test',
  name: 'Member',
  staffRole: null,
  memberId: 'member-1',
};

const impersonation: ImpersonationPrincipal = {
  id: 'imp-1',
  actorUserId: 'user-1',
  actorEmail: 'person@example.test',
  actorName: 'Person',
  actorStaffRole: 'owner',
  subjectMemberId: 'member-1',
  subjectName: 'Member',
  expiresAt: '1998-08-14T11:00:00.000Z',
};

describe('authorize under impersonation', () => {
  it('passes allowlisted reads through the ordinary subject checks', () => {
    expect(authorize({ identity: subjectIdentity, impersonation }, 'community:read')).toBeNull();
    expect(authorize({ identity: subjectIdentity, impersonation }, 'lesson:play')).toBeNull();
  });

  it('refuses every mutation with the impersonation code', () => {
    expect(authorize({ identity: subjectIdentity, impersonation }, 'community:write')).toEqual({
      code: 'impersonation_read_only',
      message: 'community:write is blocked while viewing as a member',
    });
    expect(authorize({ identity: subjectIdentity, impersonation }, 'member:profile:self-write'))
      .toMatchObject({ code: 'impersonation_read_only' });
  });

  it('refuses the whole direct-message surface', () => {
    for (const capability of ['dm:read', 'dm:write'] as const) {
      expect(authorize({ identity: subjectIdentity, impersonation }, capability)).toMatchObject({
        code: 'impersonation_read_only',
      });
    }
  });

  it('decides the leave path against the acting staff account', () => {
    const asActor = { asImpersonationActor: true };
    expect(
      authorize({ identity: subjectIdentity, impersonation }, 'member:impersonate', asActor),
    ).toBeNull();
    expect(
      authorize(
        { identity: subjectIdentity, impersonation: { ...impersonation, actorStaffRole: 'admin' } },
        'member:impersonate',
        asActor,
      ),
    ).toBeNull();
    expect(authorize({ identity: subjectIdentity }, 'member:impersonate')).toMatchObject({
      code: 'forbidden',
    });
  });

  it('keeps the staff-only reads behind member:impersonate out of the member view', () => {
    expect(
      authorize({ identity: subjectIdentity, impersonation }, 'member:impersonate'),
    ).toMatchObject({ code: 'impersonation_read_only' });
  });

  it('refuses the personal-data export', () => {
    expect(
      authorize({ identity: subjectIdentity, impersonation }, 'member:data-export:self-read'),
    ).toMatchObject({ code: 'impersonation_read_only' });
  });

  it('refuses cross-tenant and platform-account reads outside the member surface', () => {
    for (const capability of ['tenant:list-own', 'account:session:self-read'] as const) {
      expect(authorize({ identity: subjectIdentity, impersonation }, capability)).toMatchObject({
        code: 'impersonation_read_only',
      });
    }
  });

  it('refuses a capability the context declares but the allowlist omits', () => {
    expect(
      authorize(
        { identity: subjectIdentity, capabilities: ['community:write'], impersonation },
        'community:write',
      ),
    ).toMatchObject({ code: 'impersonation_read_only' });
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
