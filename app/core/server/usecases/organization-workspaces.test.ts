import { describe, expect, it } from 'vitest';

import type { Identity, Organization } from '#core/domain/index.js';

import { organizationContext } from '../organization-context.js';
import { createOrganizationFakes, type OrganizationFakeWorkspace } from '../testing/organization-fakes.js';

import { linkOrganizationWorkspace, listOrganizationWorkspaces, unlinkOrganizationWorkspace } from './organization-workspaces.js';

const at = '2026-11-15T12:00:00.000Z';
const organization = (id: string, slug: string): Organization => ({
  id, slug, name: `Organization ${slug}`, status: 'active', maxWorkspaces: 2, createdAt: at, updatedAt: at,
});
const workspace = (id: string, grants: OrganizationFakeWorkspace['grants'], organizationId: string | null = null): OrganizationFakeWorkspace => ({
  id, slug: id, name: `Workspace ${id}`, status: 'active', organizationId, grants,
});

const identity = (userId: string): Identity => ({
  userId, email: `${userId}@example.test`, name: userId, emailVerified: true, image: null,
  tenantAccess: 'none', tenantId: null, tenantSlug: null, tenantName: null, staffRole: null, memberId: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
});

const harness = async () => {
  const fakes = createOrganizationFakes([], [
    workspace('acme', [{ userId: 'owner-1', role: 'owner' }, { userId: 'org-admin', role: 'owner' }, { userId: 'ws-admin', role: 'admin' }]),
    workspace('studio', [{ userId: 'outsider', role: 'owner' }]),
    workspace('akademia', [{ userId: 'owner-1', role: 'owner' }, { userId: 'other-owner', role: 'owner' }], 'org-2'),
  ]);
  const { organizations, organizationMembers } = fakes.repositories;
  await organizations.create(organization('org-1', 'holding'));
  await organizations.create(organization('org-2', 'other'));
  const member = (organizationId: string, userId: string, role: 'owner' | 'admin') =>
    organizationMembers.add(organizationId, { id: `${organizationId}-${userId}`, userId, role, createdAt: at, createdByUserId: 'operator' });
  await member('org-1', 'owner-1', 'owner');
  await member('org-1', 'ws-admin', 'owner');
  await member('org-1', 'org-admin', 'admin');
  await member('org-2', 'other-owner', 'owner');
  let next = 0;
  const deps = { ...fakes.repositories, ids: { nextId: () => `id-${++next}` }, clock: { nowIso: () => at } };
  const octx = async (userId: string, organizationId = 'org-1') => {
    const built = await organizationContext({ identity: identity(userId) }, organizationId, deps);
    if (!built.ok) throw new Error(built.error.message);
    return built.value;
  };
  return { ...fakes, deps, octx };
};

const linkOf = (h: Awaited<ReturnType<typeof harness>>, tenantId: string) => h.workspaceRows.find((row) => row.id === tenantId)?.organizationId;

describe('organization workspace link and unlink', () => {
  it('links a workspace that the organization owner also owns directly, once, with both audit rows', async () => {
    const h = await harness();
    const octx = await h.octx('owner-1');
    expect(await linkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'acme' }, h.deps)).toEqual({
      ok: true, value: { workspace: { id: 'acme', slug: 'acme', name: 'Workspace acme', status: 'active' }, changed: true },
    });
    expect(await linkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'acme' }, h.deps))
      .toMatchObject({ ok: true, value: { changed: false } });
    expect(linkOf(h, 'acme')).toBe('org-1');
    expect(h.auditRows).toEqual([{
      id: 'id-1', organizationId: 'org-1', kind: 'workspace.linked', actorUserId: 'owner-1', actorEmail: 'owner-1@example.test',
      actorKeyId: null, subjectTenantId: 'acme', subjectUserId: null, data: {}, at,
    }]);
    expect(h.tenantAuditRows).toEqual([{
      id: 'id-2', tenantId: 'acme', kind: 'organization.linked', actorUserId: 'owner-1', actorEmail: 'owner-1@example.test',
      subjectMemberId: null, reason: 'org-1', at,
    }]);
    expect(await listOrganizationWorkspaces(await h.octx('org-admin'), { organizationId: 'org-1' }, h.deps)).toEqual({
      ok: true, value: { workspaces: [{ id: 'acme', slug: 'acme', name: 'Workspace acme', status: 'active' }] },
    });
  });

  it('refuses an organization owner who is only a workspace admin', async () => {
    const h = await harness();
    expect(await linkOrganizationWorkspace(await h.octx('ws-admin'), { organizationId: 'org-1', tenantId: 'acme' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(linkOf(h, 'acme')).toBeNull();
    expect(h.auditRows).toEqual([]);
    expect(h.tenantAuditRows).toEqual([]);
  });

  it('refuses an organization owner who has no grant in a foreign workspace', async () => {
    const h = await harness();
    expect(await linkOrganizationWorkspace(await h.octx('owner-1'), { organizationId: 'org-1', tenantId: 'studio' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(linkOf(h, 'studio')).toBeNull();
  });

  it('refuses an organization admin even when that admin owns the workspace directly', async () => {
    const h = await harness();
    const octx = await h.octx('org-admin');
    expect(await linkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'acme' }, h.deps))
      .toEqual({ ok: false, error: { code: 'forbidden', message: 'organization:workspace:link is not permitted' } });
    expect(await unlinkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'acme' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(linkOf(h, 'acme')).toBeNull();
  });

  it('answers not_found to a caller outside the organization', async () => {
    const h = await harness();
    expect(await linkOrganizationWorkspace(await h.octx('outsider'), { organizationId: 'org-1', tenantId: 'studio' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await listOrganizationWorkspaces(await h.octx('outsider'), { organizationId: 'org-1' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('refuses a workspace that already belongs to another organization, for link and unlink', async () => {
    const h = await harness();
    const octx = await h.octx('owner-1');
    expect(await linkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'akademia' }, h.deps))
      .toEqual({ ok: false, error: { code: 'conflict', message: 'Workspace belongs to another organization' } });
    expect(await unlinkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'akademia' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(linkOf(h, 'akademia')).toBe('org-2');
    expect(h.auditRows).toEqual([]);
  });

  it('unlinks with both audit rows and treats a second unlink as unchanged', async () => {
    const h = await harness();
    const octx = await h.octx('owner-1');
    await linkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'acme' }, h.deps);
    expect(await unlinkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'acme' }, h.deps))
      .toMatchObject({ ok: true, value: { workspace: { id: 'acme' }, changed: true } });
    expect(await unlinkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'acme' }, h.deps))
      .toMatchObject({ ok: true, value: { changed: false } });
    expect(linkOf(h, 'acme')).toBeNull();
    expect(h.auditRows.map(({ kind, subjectTenantId }) => [kind, subjectTenantId])).toEqual([
      ['workspace.linked', 'acme'], ['workspace.unlinked', 'acme'],
    ]);
    expect(h.tenantAuditRows.map(({ kind, tenantId, reason }) => [kind, tenantId, reason])).toEqual([
      ['organization.linked', 'acme', 'org-1'], ['organization.unlinked', 'acme', 'org-1'],
    ]);
  });

  it('refuses to unlink while the workspace takes configuration from the organization', async () => {
    const h = await harness();
    const octx = await h.octx('owner-1');
    await linkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'acme' }, h.deps);
    h.configSourceTenantIds.add('acme');
    expect(await unlinkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'acme' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(linkOf(h, 'acme')).toBe('org-1');
    expect(h.auditRows.map(({ kind }) => kind)).toEqual(['workspace.linked']);
  });

  it('refuses a link past the workspace limit with workspace_quota_exceeded and links once the limit is raised', async () => {
    const h = await harness();
    const octx = await h.octx('owner-1');
    const limit = (maxWorkspaces: number) => h.repositories.organizations.setMaxWorkspaces('org-1', {
      maxWorkspaces, updatedAt: at,
      audit: {
        id: `limit-${maxWorkspaces}`, kind: 'organization.updated', actorUserId: 'operator', actorEmail: 'operator@example.test',
        actorKeyId: null, subjectTenantId: null, subjectUserId: null, data: { maxWorkspaces }, at,
      },
    });
    await limit(0);
    expect(await linkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'acme' }, h.deps)).toEqual({
      ok: false, error: { code: 'workspace_quota_exceeded', message: 'The organization already holds its maximum number of workspaces' },
    });
    expect(linkOf(h, 'acme')).toBeNull();
    expect(h.auditRows.map(({ kind }) => kind)).toEqual(['organization.updated']);
    expect(h.tenantAuditRows).toEqual([]);
    await limit(1);
    expect(await linkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'acme' }, h.deps))
      .toMatchObject({ ok: true, value: { changed: true } });
    expect(await linkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'acme' }, h.deps))
      .toMatchObject({ ok: true, value: { changed: false } });
    expect(linkOf(h, 'acme')).toBe('org-1');
  });

  it('rejects an empty workspace selection before touching the store', async () => {
    const h = await harness();
    expect(await linkOrganizationWorkspace(await h.octx('owner-1'), { organizationId: 'org-1', tenantId: ' ' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
