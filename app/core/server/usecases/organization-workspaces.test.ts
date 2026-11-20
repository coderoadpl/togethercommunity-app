import { describe, expect, it } from 'vitest';

import type { Identity, Organization, StaffGrantSource, StaffRole } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { organizationContext } from '../organization-context.js';
import { createOrganizationFakes, type OrganizationFakeWorkspace } from '../testing/organization-fakes.js';

import {
  getWorkspaceConfigSources,
  linkOrganizationWorkspace,
  listOrganizationWorkspaces,
  unlinkOrganizationWorkspace,
  unlinkWorkspaceFromOrganization,
} from './organization-workspaces.js';

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

const harness = () => {
  const fakes = createOrganizationFakes([], [
    workspace('acme', [{ userId: 'owner-1', role: 'owner' }, { userId: 'org-admin', role: 'owner' }, { userId: 'ws-admin', role: 'admin' }]),
    workspace('studio', [{ userId: 'outsider', role: 'owner' }]),
    workspace('akademia', [{ userId: 'owner-1', role: 'owner' }, { userId: 'other-owner', role: 'owner' }], 'org-2'),
    workspace('shared', [{ userId: 'owner-1', role: 'owner' }, { userId: 'outsider', role: 'owner' }, { userId: 'ws-admin', role: 'admin' }]),
  ]);
  fakes.organizationRows.push(organization('org-1', 'holding'), organization('org-2', 'other'));
  const member = (organizationId: string, userId: string, role: 'owner' | 'admin') =>
    fakes.memberRows.push({ organizationId, id: `${organizationId}-${userId}`, userId, role, createdAt: at, createdByUserId: 'operator' });
  member('org-1', 'owner-1', 'owner');
  member('org-1', 'ws-admin', 'owner');
  member('org-1', 'org-admin', 'admin');
  member('org-2', 'other-owner', 'owner');
  let next = 0;
  const deps = { ...fakes.repositories, ids: { nextId: () => `id-${++next}` }, clock: { nowIso: () => at } };
  const octx = async (userId: string, organizationId = 'org-1') => {
    const built = await organizationContext({ identity: identity(userId) }, organizationId, deps);
    if (!built.ok) throw new Error(built.error.message);
    return built.value;
  };
  const ctx = (userId: string, tenantId: string, staffRole: StaffRole, staffGrantSource?: StaffGrantSource): Ctx => ({
    identity: {
      ...identity(userId), tenantAccess: 'staff', tenantId, tenantSlug: tenantId, tenantName: `Workspace ${tenantId}`, staffRole,
      ...(staffGrantSource === undefined ? {} : { staffGrantSource }),
    },
  });
  return { ...fakes, deps, octx, ctx };
};

const linkOf = (h: ReturnType<typeof harness>, tenantId: string) => h.workspaceRows.find((row) => row.id === tenantId)?.organizationId;

describe('organization workspace link and unlink', () => {
  it('links a workspace that the organization owner also owns directly, once, with both audit rows', async () => {
    const h = harness();
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
    const h = harness();
    expect(await linkOrganizationWorkspace(await h.octx('ws-admin'), { organizationId: 'org-1', tenantId: 'acme' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(linkOf(h, 'acme')).toBeNull();
    expect(h.auditRows).toEqual([]);
    expect(h.tenantAuditRows).toEqual([]);
  });

  it('refuses an organization owner who has no grant in a foreign workspace', async () => {
    const h = harness();
    expect(await linkOrganizationWorkspace(await h.octx('owner-1'), { organizationId: 'org-1', tenantId: 'studio' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(linkOf(h, 'studio')).toBeNull();
  });

  it('refuses an organization admin even when that admin owns the workspace directly', async () => {
    const h = harness();
    const octx = await h.octx('org-admin');
    expect(await linkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'acme' }, h.deps))
      .toEqual({ ok: false, error: { code: 'forbidden', message: 'organization:workspace:link is not permitted' } });
    expect(await unlinkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'acme' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(linkOf(h, 'acme')).toBeNull();
  });

  it('answers not_found to a caller outside the organization', async () => {
    const h = harness();
    expect(await linkOrganizationWorkspace(await h.octx('outsider'), { organizationId: 'org-1', tenantId: 'studio' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await listOrganizationWorkspaces(await h.octx('outsider'), { organizationId: 'org-1' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('refuses a workspace that already belongs to another organization, for link and unlink', async () => {
    const h = harness();
    const octx = await h.octx('owner-1');
    expect(await linkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'akademia' }, h.deps))
      .toEqual({ ok: false, error: { code: 'conflict', message: 'Workspace belongs to another organization' } });
    expect(await unlinkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'akademia' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(linkOf(h, 'akademia')).toBe('org-2');
    expect(h.auditRows).toEqual([]);
  });

  it('unlinks with both audit rows and treats a second unlink as unchanged', async () => {
    const h = harness();
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
    const h = harness();
    const octx = await h.octx('owner-1');
    await linkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'acme' }, h.deps);
    h.configSourceRows.push({ tenantId: 'acme', group: 'telemetry', source: 'organization', updatedAt: '2026-11-15T12:00:00.000Z', updatedByUserId: 'owner-1' });
    expect(await unlinkOrganizationWorkspace(octx, { organizationId: 'org-1', tenantId: 'acme' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(linkOf(h, 'acme')).toBe('org-1');
    expect(h.auditRows.map(({ kind }) => kind)).toEqual(['workspace.linked']);
  });

  it('refuses a link past the workspace limit with workspace_quota_exceeded and links once the limit is raised', async () => {
    const h = harness();
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
    const h = harness();
    expect(await linkOrganizationWorkspace(await h.octx('owner-1'), { organizationId: 'org-1', tenantId: ' ' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});

describe('unlinking from either side', () => {
  const linked = async (tenantId: string) => {
    const h = await harness();
    expect(await linkOrganizationWorkspace(await h.octx('owner-1'), { organizationId: 'org-1', tenantId }, h.deps))
      .toMatchObject({ ok: true, value: { changed: true } });
    return h;
  };

  it('lets a direct workspace owner outside the organization unlink, with both audit rows naming the organization', async () => {
    const h = await linked('shared');
    expect(await unlinkWorkspaceFromOrganization(h.ctx('outsider', 'shared', 'owner', 'direct'), h.deps)).toEqual({
      ok: true, value: { workspace: { id: 'shared', slug: 'shared', name: 'Workspace shared', status: 'active' }, changed: true },
    });
    expect(linkOf(h, 'shared')).toBeNull();
    expect(h.auditRows.at(-1)).toEqual({
      id: 'id-3', organizationId: 'org-1', kind: 'workspace.unlinked', actorUserId: 'outsider', actorEmail: 'outsider@example.test',
      actorKeyId: null, subjectTenantId: 'shared', subjectUserId: null, data: {}, at,
    });
    expect(h.tenantAuditRows.at(-1)).toEqual({
      id: 'id-4', tenantId: 'shared', kind: 'organization.unlinked', actorUserId: 'outsider', actorEmail: 'outsider@example.test',
      subjectMemberId: null, reason: 'org-1', at,
    });
    expect(await unlinkWorkspaceFromOrganization(h.ctx('outsider', 'shared', 'owner', 'direct'), h.deps))
      .toMatchObject({ ok: true, value: { changed: false } });
  });

  it('refuses the workspace route to a derived owner, an owner of unknown source, an admin, a key and an impersonated view', async () => {
    const h = await linked('shared');
    const refusals: Array<[string, Ctx, string]> = [
      ['derived owner', h.ctx('ws-admin', 'shared', 'owner', 'organization'), 'forbidden'],
      ['unknown source', h.ctx('outsider', 'shared', 'owner'), 'forbidden'],
      ['direct admin', h.ctx('ws-admin', 'shared', 'admin', 'direct'), 'forbidden'],
      ['forged direct source', h.ctx('ws-admin', 'shared', 'owner', 'direct'), 'forbidden'],
      ['shop key', { ...h.ctx('outsider', 'shared', 'owner', 'direct'), machineActor: { kind: 'shop_management_key', apiKeyId: 'key-1' } }, 'forbidden'],
      ['impersonation', {
        ...h.ctx('outsider', 'shared', 'owner', 'direct'),
        impersonation: {
          id: 'session-1', actorUserId: 'owner-1', actorEmail: 'owner-1@example.test', actorName: 'owner-1', actorStaffRole: 'owner',
          subjectMemberId: 'member-1', subjectName: 'Member', expiresAt: at,
        },
      }, 'impersonation_read_only'],
    ];
    for (const [label, ctx, code] of refusals) {
      expect(await unlinkWorkspaceFromOrganization(ctx, h.deps), label).toMatchObject({ ok: false, error: { code } });
    }
    expect(linkOf(h, 'shared')).toBe('org-1');
    expect(h.auditRows.map(({ kind }) => kind)).toEqual(['workspace.linked']);
  });

  it('lets an organization owner without a direct owner grant unlink through the organization', async () => {
    const h = await linked('shared');
    expect(await unlinkOrganizationWorkspace(await h.octx('ws-admin'), { organizationId: 'org-1', tenantId: 'shared' }, h.deps))
      .toMatchObject({ ok: true, value: { workspace: { id: 'shared' }, changed: true } });
    expect(linkOf(h, 'shared')).toBeNull();
    expect(await unlinkOrganizationWorkspace(await h.octx('ws-admin'), { organizationId: 'org-1', tenantId: 'shared' }, h.deps))
      .toEqual({ ok: false, error: { code: 'not_found', message: 'Workspace not found in this organization' } });
    expect(await unlinkOrganizationWorkspace(await h.octx('ws-admin'), { organizationId: 'org-1', tenantId: 'akademia' }, h.deps))
      .toEqual({ ok: false, error: { code: 'not_found', message: 'Workspace not found in this organization' } });
  });

  it('refuses both routes while a configuration group takes the organization source', async () => {
    const h = await linked('shared');
    h.configSourceRows.push({ tenantId: 'shared', group: 'invoicing', source: 'organization', updatedAt: at, updatedByUserId: 'owner-1' });
    expect(await unlinkWorkspaceFromOrganization(h.ctx('outsider', 'shared', 'owner', 'direct'), h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await unlinkOrganizationWorkspace(await h.octx('ws-admin'), { organizationId: 'org-1', tenantId: 'shared' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(linkOf(h, 'shared')).toBe('org-1');
  });
});

describe('workspace configuration sources', () => {
  it('reports every group of a linked workspace, workspace by default and organization where a source row exists', async () => {
    const h = await harness();
    await linkOrganizationWorkspace(await h.octx('owner-1'), { organizationId: 'org-1', tenantId: 'acme' }, h.deps);
    const admin = await h.octx('org-admin');
    const before = await getWorkspaceConfigSources(admin, { organizationId: 'org-1', tenantId: 'acme' }, h.deps);
    expect(before).toMatchObject({ ok: true, value: { workspace: { id: 'acme', slug: 'acme' } } });
    expect(before.ok && before.value.sources.map(({ group, source }) => [group, source])).toEqual([
      ['payments_live', 'workspace'], ['payments_test', 'workspace'], ['invoicing', 'workspace'],
      ['email_transport', 'workspace'], ['telemetry', 'workspace'], ['shipping_carrier', 'workspace'],
    ]);
    h.configSourceRows.push({ tenantId: 'acme', group: 'invoicing', source: 'organization', updatedAt: at, updatedByUserId: 'owner-1' });
    const after = await getWorkspaceConfigSources(admin, { organizationId: 'org-1', tenantId: 'acme' }, h.deps);
    expect(after.ok && after.value.sources.find(({ group }) => group === 'invoicing'))
      .toEqual({ group: 'invoicing', source: 'organization', updatedAt: at, updatedByUserId: 'owner-1' });
  });

  it('answers not_found for a workspace outside the organization and for a non-member', async () => {
    const h = await harness();
    const owner = await h.octx('owner-1');
    for (const tenantId of ['studio', 'akademia', 'missing']) {
      expect(await getWorkspaceConfigSources(owner, { organizationId: 'org-1', tenantId }, h.deps), tenantId)
        .toMatchObject({ ok: false, error: { code: 'not_found', message: 'Workspace not found in this organization' } });
    }
    expect(await getWorkspaceConfigSources(await h.octx('outsider'), { organizationId: 'org-1', tenantId: 'acme' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found', message: 'Organization not found' } });
  });
});
