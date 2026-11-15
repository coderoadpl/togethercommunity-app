import { describe, expect, it } from 'vitest';

import type { Identity, Organization } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { organizationContext } from '../organization-context.js';
import { createOrganizationFakes } from '../testing/organization-fakes.js';

import { getOrganization, listOrganizationAuditEvents, listOrganizationMembers, listOrganizations } from './organizations.js';

const at = '2026-11-15T12:00:00.000Z';
const organization = (id: string, slug: string): Organization => ({
  id, slug, name: `Organization ${slug}`, status: 'active', maxWorkspaces: 2, createdAt: at, updatedAt: at,
});

const sessionCtx = (userId: string, tenantId: string | null = null): Ctx => {
  const identity: Identity = {
    userId, email: `${userId}@example.test`, name: userId, emailVerified: true, image: null,
    tenantAccess: tenantId === null ? 'none' : 'staff', tenantId, tenantSlug: tenantId, tenantName: tenantId,
    staffRole: tenantId === null ? null : 'owner', memberId: null, memberDisplayName: null, memberBannedAt: null,
    memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
  };
  return { identity };
};

const harness = () => {
  const fakes = createOrganizationFakes([
    { userId: 'owner-1', email: 'owner-1@example.test', emailVerified: true },
    { userId: 'admin-1', email: 'admin-1@example.test', emailVerified: true },
    { userId: 'outsider', email: 'outsider@example.test', emailVerified: true },
  ]);
  fakes.organizationRows.push(organization('org-1', 'holding'), organization('org-2', 'other'));
  fakes.memberRows.push(
    { organizationId: 'org-1', id: 'm-1', userId: 'owner-1', role: 'owner', createdAt: at, createdByUserId: 'operator-secret' },
    { organizationId: 'org-1', id: 'm-2', userId: 'admin-1', role: 'admin', createdAt: at, createdByUserId: 'owner-1' },
    { organizationId: 'org-2', id: 'm-3', userId: 'outsider', role: 'owner', createdAt: at, createdByUserId: 'operator-secret' },
  );
  fakes.auditRows.push({
    organizationId: 'org-1', id: 'a-1', kind: 'organization.created', actorUserId: 'operator-secret', actorEmail: 'operator@together.invalid',
    actorKeyId: null, subjectTenantId: null, subjectUserId: null, data: { slug: 'holding' }, at,
  });
  const octx = async (userId: string, organizationId = 'org-1', tenantId: string | null = null) => {
    const built = await organizationContext(sessionCtx(userId, tenantId), organizationId, fakes.repositories);
    if (!built.ok) throw new Error(built.error.message);
    return built.value;
  };
  return { ...fakes.repositories, octx };
};

describe('organization reads', () => {
  it('lists only the caller memberships with their role', async () => {
    const h = harness();
    expect(await listOrganizations(sessionCtx('admin-1'), h)).toEqual({
      ok: true, value: { organizations: [{ id: 'org-1', slug: 'holding', name: 'Organization holding', status: 'active', role: 'admin' }] },
    });
    expect(await listOrganizations(sessionCtx('nobody'), h)).toEqual({ ok: true, value: { organizations: [] } });
  });

  it('answers not_found to a non-member for the organization, its members and its audit', async () => {
    const h = harness();
    for (const organizationId of ['org-1', 'org-missing']) {
      const octx = await h.octx('outsider', organizationId);
      expect(await getOrganization(octx, { organizationId }, h)).toEqual({ ok: false, error: { code: 'not_found', message: 'Organization not found' } });
      expect(await listOrganizationMembers(octx, { organizationId }, h)).toMatchObject({ ok: false, error: { code: 'not_found' } });
      expect(await listOrganizationAuditEvents(octx, { organizationId, limit: 25 }, h)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    }
  });

  it('ignores the workspace grant of the request when deciding organization access', async () => {
    const h = harness();
    const octx = await h.octx('outsider', 'org-1', 'tenant-1');
    expect(await getOrganization(octx, { organizationId: 'org-1' }, h)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('lets an admin read the organization, its members and its audit', async () => {
    const h = harness();
    const octx = await h.octx('admin-1');
    expect(await getOrganization(octx, { organizationId: 'org-1' }, h)).toEqual({
      ok: true, value: { organization: organization('org-1', 'holding'), role: 'admin' },
    });
    expect(await listOrganizationMembers(octx, { organizationId: 'org-1' }, h)).toEqual({
      ok: true,
      value: { members: [
        { userId: 'owner-1', email: 'owner-1@example.test', role: 'owner', createdAt: at },
        { userId: 'admin-1', email: 'admin-1@example.test', role: 'admin', createdAt: at },
      ] },
    });
    expect(await listOrganizationAuditEvents(octx, { organizationId: 'org-1', limit: 25 }, h)).toMatchObject({
      ok: true, value: { events: [{ id: 'a-1', kind: 'organization.created', organizationId: 'org-1' }] },
    });
  });

  it('refuses organization access while viewing as a member', async () => {
    const h = harness();
    const impersonated: Ctx = {
      ...sessionCtx('owner-1', 'tenant-1'),
      impersonation: {
        id: 'view-1', actorUserId: 'owner-1', actorEmail: 'owner-1@example.test', actorName: 'Owner', actorStaffRole: 'owner',
        subjectMemberId: 'member-1', subjectName: 'Member', expiresAt: at,
      },
    };
    expect(await organizationContext(impersonated, 'org-1', h)).toMatchObject({ ok: false, error: { code: 'impersonation_read_only' } });
    expect(await listOrganizations(impersonated, h)).toMatchObject({ ok: false, error: { code: 'impersonation_read_only' } });
  });
});
