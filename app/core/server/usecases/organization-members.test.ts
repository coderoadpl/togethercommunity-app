import { describe, expect, it } from 'vitest';

import type { Identity, Organization } from '#core/domain/index.js';

import { organizationContext } from '../organization-context.js';
import { createOrganizationFakes } from '../testing/organization-fakes.js';

import { addOrganizationMember, removeOrganizationMember, setOrganizationMemberRole } from './organization-members.js';
import { getOrganization, listOrganizationMembers } from './organizations.js';

const at = '2026-11-15T12:00:00.000Z';
const organization: Organization = {
  id: 'org-1', slug: 'holding', name: 'Organization holding', status: 'active', maxWorkspaces: 2, createdAt: at, updatedAt: at,
};

const identity = (userId: string): Identity => ({
  userId, email: `${userId}@example.test`, name: userId, emailVerified: true, image: null,
  tenantAccess: 'none', tenantId: null, tenantSlug: null, tenantName: null, staffRole: null, memberId: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
});

const harness = () => {
  const fakes = createOrganizationFakes([
    { userId: 'owner-1', email: 'owner-1@example.test', emailVerified: true },
    { userId: 'admin-1', email: 'admin-1@example.test', emailVerified: true },
    { userId: 'candidate', email: 'candidate@example.test', emailVerified: true },
    { userId: 'pending', email: 'pending@example.test', emailVerified: false },
    { userId: 'outsider', email: 'outsider@example.test', emailVerified: true },
  ]);
  fakes.organizationRows.push(organization);
  fakes.memberRows.push(
    { organizationId: 'org-1', id: 'm-1', userId: 'owner-1', role: 'owner', createdAt: at, createdByUserId: 'operator' },
    { organizationId: 'org-1', id: 'm-2', userId: 'admin-1', role: 'admin', createdAt: at, createdByUserId: 'owner-1' },
  );
  let next = 0;
  const deps = { ...fakes.repositories, authPort: fakes.authPort, ids: { nextId: () => `id-${++next}` }, clock: { nowIso: () => at } };
  const octx = async (userId: string) => {
    const built = await organizationContext({ identity: identity(userId) }, 'org-1', deps);
    if (!built.ok) throw new Error(built.error.message);
    return built.value;
  };
  const roles = () => fakes.memberRows.map(({ userId, role }) => [userId, role]);
  return { ...fakes, deps, octx, roles };
};

describe('organization member management', () => {
  it('adds an existing verified account with its audit row and treats a repeat with the same role as unchanged', async () => {
    const h = harness();
    const octx = await h.octx('owner-1');
    expect(await addOrganizationMember(octx, { organizationId: 'org-1', email: ' Candidate@Example.test ', role: 'admin' }, h.deps)).toEqual({
      ok: true, value: { member: { userId: 'candidate', email: 'candidate@example.test', role: 'admin', createdAt: at }, changed: true },
    });
    expect(await addOrganizationMember(octx, { organizationId: 'org-1', email: 'candidate@example.test', role: 'admin' }, h.deps))
      .toMatchObject({ ok: true, value: { changed: false } });
    expect(await addOrganizationMember(octx, { organizationId: 'org-1', email: 'candidate@example.test', role: 'owner' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(h.roles()).toEqual([['owner-1', 'owner'], ['admin-1', 'admin'], ['candidate', 'admin']]);
    expect(h.auditRows).toEqual([{
      id: 'id-2', organizationId: 'org-1', kind: 'member.added', actorUserId: 'owner-1', actorEmail: 'owner-1@example.test',
      actorKeyId: null, subjectTenantId: null, subjectUserId: 'candidate', data: { role: 'admin' }, at,
    }]);
  });

  it.each(['missing@example.test', 'pending@example.test'])('refuses to add %s without an invitation or a row', async (email) => {
    const h = harness();
    expect(await addOrganizationMember(await h.octx('owner-1'), { organizationId: 'org-1', email, role: 'admin' }, h.deps))
      .toEqual({ ok: false, error: { code: 'validation', message: 'Account not found or not verified' } });
    expect(h.memberRows).toHaveLength(2);
    expect(h.auditRows).toEqual([]);
  });

  it('refuses every member write by an organization admin', async () => {
    const h = harness();
    const octx = await h.octx('admin-1');
    expect(await addOrganizationMember(octx, { organizationId: 'org-1', email: 'candidate@example.test', role: 'admin' }, h.deps))
      .toEqual({ ok: false, error: { code: 'forbidden', message: 'organization:member:write is not permitted' } });
    expect(await setOrganizationMemberRole(octx, { organizationId: 'org-1', email: 'admin-1@example.test', role: 'owner' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await removeOrganizationMember(octx, { organizationId: 'org-1', email: 'owner-1@example.test' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.roles()).toEqual([['owner-1', 'owner'], ['admin-1', 'admin']]);
    expect(h.auditRows).toEqual([]);
  });

  it('answers not_found to a caller outside the organization', async () => {
    const h = harness();
    expect(await addOrganizationMember(await h.octx('outsider'), { organizationId: 'org-1', email: 'outsider@example.test', role: 'owner' }, h.deps))
      .toEqual({ ok: false, error: { code: 'not_found', message: 'Organization not found' } });
    expect(h.memberRows).toHaveLength(2);
  });

  it('never removes or demotes the last owner, including the owner acting on themselves', async () => {
    const h = harness();
    const octx = await h.octx('owner-1');
    const lastOwner = { ok: false, error: { code: 'conflict', message: 'The last owner of an organization cannot be demoted or removed' } };
    expect(await setOrganizationMemberRole(octx, { organizationId: 'org-1', email: 'owner-1@example.test', role: 'admin' }, h.deps)).toEqual(lastOwner);
    expect(await removeOrganizationMember(octx, { organizationId: 'org-1', email: 'owner-1@example.test' }, h.deps)).toEqual(lastOwner);
    expect(h.roles()).toEqual([['owner-1', 'owner'], ['admin-1', 'admin']]);
    expect(h.auditRows).toEqual([]);
  });

  it('changes roles with a from/to audit row and lets a second owner demote the first', async () => {
    const h = harness();
    const owner = await h.octx('owner-1');
    expect(await setOrganizationMemberRole(owner, { organizationId: 'org-1', email: 'admin-1@example.test', role: 'owner' }, h.deps))
      .toEqual({ ok: true, value: { member: { userId: 'admin-1', email: 'admin-1@example.test', role: 'owner', createdAt: at }, changed: true } });
    expect(await setOrganizationMemberRole(owner, { organizationId: 'org-1', email: 'admin-1@example.test', role: 'owner' }, h.deps))
      .toMatchObject({ ok: true, value: { changed: false } });
    expect(await setOrganizationMemberRole(await h.octx('admin-1'), { organizationId: 'org-1', email: 'owner-1@example.test', role: 'admin' }, h.deps))
      .toMatchObject({ ok: true, value: { member: { userId: 'owner-1', role: 'admin' }, changed: true } });
    expect(await removeOrganizationMember(await h.octx('admin-1'), { organizationId: 'org-1', email: 'admin-1@example.test' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(h.roles()).toEqual([['owner-1', 'admin'], ['admin-1', 'owner']]);
    expect(h.auditRows.map(({ kind, actorUserId, subjectUserId, data }) => [kind, actorUserId, subjectUserId, data])).toEqual([
      ['member.role_changed', 'owner-1', 'admin-1', { from: 'admin', to: 'owner' }],
      ['member.role_changed', 'admin-1', 'owner-1', { from: 'owner', to: 'admin' }],
    ]);
  });

  it('answers not_found for an account that is not a member', async () => {
    const h = harness();
    const octx = await h.octx('owner-1');
    for (const email of ['candidate@example.test', 'missing@example.test']) {
      expect(await setOrganizationMemberRole(octx, { organizationId: 'org-1', email, role: 'admin' }, h.deps))
        .toEqual({ ok: false, error: { code: 'not_found', message: 'Organization member not found' } });
      expect(await removeOrganizationMember(octx, { organizationId: 'org-1', email }, h.deps))
        .toMatchObject({ ok: false, error: { code: 'not_found' } });
    }
  });

  it('takes organization access away from a removed owner on the very next request', async () => {
    const h = harness();
    await addOrganizationMember(await h.octx('owner-1'), { organizationId: 'org-1', email: 'candidate@example.test', role: 'owner' }, h.deps);
    expect(await getOrganization(await h.octx('candidate'), { organizationId: 'org-1' }, h.deps))
      .toMatchObject({ ok: true, value: { role: 'owner' } });
    expect(await removeOrganizationMember(await h.octx('owner-1'), { organizationId: 'org-1', email: 'candidate@example.test' }, h.deps))
      .toEqual({ ok: true, value: { member: { userId: 'candidate', email: 'candidate@example.test', role: 'owner', createdAt: at }, changed: true } });
    const nextRequest = await h.octx('candidate');
    expect(await getOrganization(nextRequest, { organizationId: 'org-1' }, h.deps))
      .toEqual({ ok: false, error: { code: 'not_found', message: 'Organization not found' } });
    expect(await listOrganizationMembers(nextRequest, { organizationId: 'org-1' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await addOrganizationMember(nextRequest, { organizationId: 'org-1', email: 'candidate@example.test', role: 'owner' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.auditRows.map(({ kind, data }) => [kind, data])).toEqual([['member.added', { role: 'owner' }], ['member.removed', { role: 'owner' }]]);
  });

  it('re-checks owner standing inside the store when the actor was demoted after the context was built', async () => {
    const h = harness();
    await setOrganizationMemberRole(await h.octx('owner-1'), { organizationId: 'org-1', email: 'admin-1@example.test', role: 'owner' }, h.deps);
    const stale = await h.octx('owner-1');
    await setOrganizationMemberRole(await h.octx('admin-1'), { organizationId: 'org-1', email: 'owner-1@example.test', role: 'admin' }, h.deps);
    expect(await removeOrganizationMember(stale, { organizationId: 'org-1', email: 'admin-1@example.test' }, h.deps))
      .toEqual({ ok: false, error: { code: 'forbidden', message: 'organization:member:write is not permitted' } });
    expect(h.roles()).toEqual([['owner-1', 'admin'], ['admin-1', 'owner']]);
  });

  it('rejects a malformed e-mail before touching the store', async () => {
    const h = harness();
    expect(await addOrganizationMember(await h.octx('owner-1'), { organizationId: 'org-1', email: 'not-an-email', role: 'admin' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.memberRows).toHaveLength(2);
  });
});
