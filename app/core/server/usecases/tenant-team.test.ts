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
    { userId: 'owner-1', email: 'owner@acme.test', name: 'Owner', role: 'owner' },
    { userId: 'admin-1', email: 'admin@acme.test', name: null, role: 'admin' },
    { userId: 'owner-2', email: 'second-owner@acme.test', name: 'Second owner', role: 'owner' },
  ];
  const audit: TenantAuditEventInput[] = [];
  const ensured: string[] = [];
  const requestMagicLink = vi.fn<TenantTeamDeps['authPort']['requestMagicLink']>(async () => undefined);
  const deps: TenantTeamDeps = {
    team: {
      list: vi.fn(async () => members),
      addAdmin: vi.fn(async (_tenantId, userId, _id, event) => {
        if (members.some((member) => member.userId === userId)) return false;
        members.push({ userId, email: ensured.at(-1) ?? '', name: null, role: 'admin' });
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
      findUserByEmail: async (email) => ({
        userId: members.find((member) => member.email === email)?.userId ?? 'new-user',
        emailVerified: true,
      }),
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

  it('normalizes the email, grants admin, audits, and queues the existing sign-in email', async () => {
    const h = harness();
    const result = await addTenantAdmin({ identity: identity() }, { email: '  NEW@ACME.TEST  ' }, h.deps);
    expect(result).toEqual({ ok: true, value: { userId: 'new-user' } });
    expect(h.ensured).toEqual(['new@acme.test']);
    expect(h.members).toContainEqual({ userId: 'new-user', email: 'new@acme.test', name: null, role: 'admin' });
    expect(h.deps.team.addAdmin).toHaveBeenCalledWith('tenant-1', 'new-user', 'id-1', expect.objectContaining({ kind: 'team.admin_added' }));
    expect(h.audit).toEqual([expect.objectContaining({
      tenantId: 'tenant-1', kind: 'team.admin_added', actorUserId: 'owner-1', reason: 'new-user',
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
    expect(h.requestMagicLink).not.toHaveBeenCalled();
  });

  it.each([false, true])('withholds administrator access until mailbox verification (created: %s)', async (created) => {
    const h = harness();
    h.deps.authPort.ensureUser = async () => ({ userId: 'unverified-password-user', created });
    h.deps.authPort.findUserByEmail = async () => ({ userId: 'unverified-password-user', emailVerified: false });

    expect(await addTenantAdmin({ identity: identity() }, { email: 'invitee@acme.test' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'validation', details: { reason: 'verification_pending' } } });
    expect(h.deps.team.addAdmin).not.toHaveBeenCalled();
    expect(h.members.some((member) => member.userId === 'unverified-password-user')).toBe(false);
    expect(h.audit).toEqual([]);
    expect(h.requestMagicLink).toHaveBeenCalledWith(expect.objectContaining({ email: 'invitee@acme.test' }));

    h.deps.authPort.findUserByEmail = async () => ({ userId: 'unverified-password-user', emailVerified: true });
    expect(await addTenantAdmin({ identity: identity() }, { email: 'invitee@acme.test' }, h.deps))
      .toEqual({ ok: true, value: { userId: 'unverified-password-user' } });
    expect(h.deps.team.addAdmin).toHaveBeenCalledOnce();
    expect(h.audit).toHaveLength(1);
  });

  it.each([null, { userId: 'another-user', emailVerified: true }])('refuses an account that disappeared or changed after provisioning: %j', async (account) => {
    const h = harness();
    h.deps.authPort.findUserByEmail = async () => account;
    expect(await addTenantAdmin({ identity: identity() }, { email: 'invitee@acme.test' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'validation', details: { reason: 'verification_pending' } } });
    expect(h.deps.team.addAdmin).not.toHaveBeenCalled();
    expect(h.audit).toEqual([]);
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
    expect(h.deps.team.addAdmin).not.toHaveBeenCalled();
    expect(h.deps.team.removeAdmin).not.toHaveBeenCalled();
    expect(h.ensured).toEqual([]);
    expect(h.audit).toEqual([]);
    expect(h.requestMagicLink).not.toHaveBeenCalled();
  });

  it('rejects malformed email before creating an auth user', async () => {
    const h = harness();
    expect(await addTenantAdmin({ identity: identity() }, { email: 'invalid' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'validation', details: { reason: 'invalid_email' } } });
    expect(h.ensured).toEqual([]);
  });

  it('refuses a missing user without recording a removal', async () => {
    const h = harness();
    expect(await removeTenantAdmin({ identity: identity() }, { userId: 'missing' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.audit).toEqual([]);
  });
});
