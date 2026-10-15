import { describe, expect, it, vi } from 'vitest';

import type { Identity, StaffRole, TenantAuditEventInput, TenantTeamMember } from '#core/domain/index.js';

import { createInMemoryTenantDomainRepository, tenantDomainFixture } from '../testing/tenant-domain-fakes.js';

import { addTenantAdmin, listTenantTeam, removeTenantAdmin, type TenantTeamDeps } from './tenant-team.js';

const identity = (staffRole: StaffRole | null = 'owner'): Identity => ({
  userId: 'owner-1',
  email: 'owner@acme.test',
  name: 'Owner',
  emailVerified: true,
  image: null,
  tenantAccess: staffRole === null ? 'member' : 'staff',
  tenantId: 'tenant-1',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole,
  memberId: staffRole === null ? 'member-1' : null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
});

const harness = () => {
  const members: TenantTeamMember[] = [
    { userId: 'owner-1', email: 'owner@acme.test', name: 'Owner', role: 'owner', status: 'active' },
    { userId: 'admin-1', email: 'admin@acme.test', name: null, role: 'admin', status: 'active' },
    { userId: 'owner-2', email: 'second-owner@acme.test', name: 'Second owner', role: 'owner', status: 'active' },
  ];
  const audit: TenantAuditEventInput[] = [];
  const ensured: string[] = [];
  const requestMagicLink = vi.fn<TenantTeamDeps['authPort']['requestMagicLink']>(async () => undefined);
  const deps: TenantTeamDeps = {
    team: {
      list: vi.fn(async () => members),
      inviteAdmin: vi.fn(async (_tenantId, userId, email, _id, event) => {
        if (members.some((member) => member.userId === userId)) return false;
        members.push({ userId, email, name: null, role: 'admin', status: 'invited' });
        audit.push(event);
        return true;
      }),
      activateInvitation: vi.fn(async () => false),
      revokeInvitation: vi.fn(async (_tenantId, userId, event) => {
        const index = members.findIndex((member) => member.userId === userId && member.status === 'invited');
        if (index === -1) return false;
        members.splice(index, 1);
        audit.push(event);
        return true;
      }),
      removeAdmin: vi.fn(async (_tenantId, userId, event) => {
        const index = members.findIndex((member) => member.userId === userId && member.role === 'admin');
        if (index === -1) return false;
        members.splice(index, 1);
        audit.push(event);
        return true;
      }),
    },
    authPort: {
      ensureUser: async (email) => {
        ensured.push(email);
        const existing = members.find((member) => member.email === email);
        return { userId: existing?.userId ?? 'new-user', created: existing === undefined };
      },
      requestMagicLink,
    },
    tenants: { findSettings: async () => null },
    ids: { nextId: () => 'id-1' },
    clock: { nowIso: () => '2026-10-13T12:00:00.000Z' },
    tenantDomains: createInMemoryTenantDomainRepository(),
    appBaseUrl: 'https://app.together.test',
    baseDomain: 'together.test',
    singleTenantMode: false,
  };
  return { deps, members, audit, ensured, requestMagicLink };
};

describe('tenant team', () => {
  it('allows an owner to list staff in the selected tenant', async () => {
    const h = harness();
    expect(await listTenantTeam({ identity: identity() }, h.deps)).toEqual({ ok: true, value: { members: h.members } });
    expect(h.deps.team.list).toHaveBeenCalledWith('tenant-1');
  });

  it('normalizes the email, records an invitation, audits, and queues the sign-in email', async () => {
    const h = harness();
    const result = await addTenantAdmin({ identity: identity() }, { email: '  NEW@ACME.TEST  ' }, h.deps);
    expect(result).toEqual({ ok: true, value: { status: 'invitation_sent' } });
    expect(h.ensured).toEqual(['new@acme.test']);
    expect(h.members).toContainEqual({ userId: 'new-user', email: 'new@acme.test', name: null, role: 'admin', status: 'invited' });
    expect(h.deps.team.inviteAdmin).toHaveBeenCalledWith('tenant-1', 'new-user', 'new@acme.test', 'id-1', expect.objectContaining({ kind: 'team.admin_invited' }));
    expect(h.audit).toEqual([expect.objectContaining({
      tenantId: 'tenant-1', kind: 'team.admin_invited', actorUserId: 'owner-1', reason: 'new-user',
    })]);
    expect(h.requestMagicLink).toHaveBeenCalledWith({
      email: 'new@acme.test',
      callbackURL: 'https://acme.together.test/',
      tenantId: 'tenant-1',
      tenantName: 'Acme',
      language: 'en',
      baseUrl: 'https://acme.together.test/',
    });
  });

  it('uses the verified custom domain for the sign-in email', async () => {
    const h = harness();
    h.deps.tenantDomains = createInMemoryTenantDomainRepository([
      tenantDomainFixture({ id: 'domain-1', tenantId: 'tenant-1', domain: 'community.acme.test', verified: true }),
    ]);
    await addTenantAdmin({ identity: identity() }, { email: 'new@acme.test' }, h.deps);
    expect(h.requestMagicLink).toHaveBeenCalledWith(expect.objectContaining({
      callbackURL: 'https://community.acme.test/', baseUrl: 'https://community.acme.test/',
    }));
  });

  it.each(['admin@acme.test', 'owner@acme.test'])('preserves existing role when adding %s again', async (email) => {
    const h = harness();
    const original = structuredClone(h.members);
    expect((await addTenantAdmin({ identity: identity() }, { email }, h.deps)).ok).toBe(true);
    expect((await addTenantAdmin({ identity: identity() }, { email }, h.deps)).ok).toBe(true);
    expect(h.members).toEqual(original);
    expect(h.audit).toEqual([]);
    expect(h.requestMagicLink).toHaveBeenCalledTimes(2);
  });

  it('returns byte-identical opaque results for verified, unverified, and unknown accounts', async () => {
    const responses: string[] = [];
    for (const account of ['verified', 'unverified', 'unknown']) {
      const h = harness();
      h.deps.authPort.ensureUser = async () => ({ userId: `${account}-user`, created: account === 'unknown' });
      responses.push(JSON.stringify(await addTenantAdmin({ identity: identity() }, { email: `${account}@acme.test` }, h.deps)));
      expect(h.members.at(-1)).toMatchObject({ userId: `${account}-user`, status: 'invited' });
      expect(h.audit).toEqual([expect.objectContaining({ kind: 'team.admin_invited' })]);
      expect(h.requestMagicLink).toHaveBeenCalledOnce();
    }
    expect(new Set(responses)).toEqual(new Set([JSON.stringify({ ok: true, value: { status: 'invitation_sent' } })]));
  });

  it('revokes a pending invitation and audits the revocation', async () => {
    const h = harness();
    await addTenantAdmin({ identity: identity() }, { email: 'invitee@acme.test' }, h.deps);
    expect(await removeTenantAdmin({ identity: identity() }, { userId: 'new-user' }, h.deps))
      .toEqual({ ok: true, value: { userId: 'new-user' } });
    expect(h.members.some((member) => member.userId === 'new-user')).toBe(false);
    expect(h.deps.team.removeAdmin).not.toHaveBeenCalled();
    expect(h.audit).toEqual([
      expect.objectContaining({ kind: 'team.admin_invited' }),
      expect.objectContaining({ kind: 'team.invitation_revoked' }),
    ]);
  });

  it('allows an owner to remove an administrator and records the audit event', async () => {
    const h = harness();
    expect(await removeTenantAdmin({ identity: identity() }, { userId: 'admin-1' }, h.deps))
      .toEqual({ ok: true, value: { userId: 'admin-1' } });
    expect(h.members.some((member) => member.userId === 'admin-1')).toBe(false);
    expect(h.deps.team.removeAdmin).toHaveBeenCalledWith('tenant-1', 'admin-1', expect.objectContaining({ kind: 'team.admin_removed' }));
    expect(h.audit).toEqual([expect.objectContaining({
      tenantId: 'tenant-1', kind: 'team.admin_removed', actorUserId: 'owner-1', reason: 'admin-1',
    })]);
  });

  it.each(['owner-1', 'owner-2'])('refuses to remove the caller or another owner: %s', async (userId) => {
    const h = harness();
    expect(await removeTenantAdmin({ identity: identity() }, { userId }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.deps.team.removeAdmin).not.toHaveBeenCalled();
    expect(h.audit).toEqual([]);
  });

  it.each<StaffRole | null>(['admin', null])('rejects all team operations for role %s before side effects', async (role) => {
    const h = harness();
    const ctx = { identity: identity(role) };
    const results = await Promise.all([
      listTenantTeam(ctx, h.deps),
      addTenantAdmin(ctx, { email: 'new@acme.test' }, h.deps),
      removeTenantAdmin(ctx, { userId: 'admin-1' }, h.deps),
    ]);
    for (const result of results) expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.deps.team.list).not.toHaveBeenCalled();
    expect(h.deps.team.inviteAdmin).not.toHaveBeenCalled();
    expect(h.deps.team.removeAdmin).not.toHaveBeenCalled();
    expect(h.ensured).toEqual([]);
    expect(h.audit).toEqual([]);
    expect(h.requestMagicLink).not.toHaveBeenCalled();
  });

  it('rejects malformed email before creating an auth user', async () => {
    const h = harness();
    expect(await addTenantAdmin({ identity: identity() }, { email: 'invalid' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.ensured).toEqual([]);
  });

  it('refuses a missing user without recording a removal', async () => {
    const h = harness();
    expect(await removeTenantAdmin({ identity: identity() }, { userId: 'missing' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.audit).toEqual([]);
  });
});
