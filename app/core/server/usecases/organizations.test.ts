import { describe, expect, it } from 'vitest';

import type { Identity, Organization } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { organizationContext } from '../organization-context.js';
import { createOrganizationFakes } from '../testing/organization-fakes.js';

import {
  getOrganization,
  listOrganizationAuditEvents,
  listOrganizationMembers,
  listOrganizations,
  updateOrganization,
} from './organizations.js';

const at = '2026-11-15T12:00:00.000Z';
const later = '2026-11-15T13:00:00.000Z';
const organization = (id: string, slug: string): Organization => ({
  id, slug, name: `Organization ${slug}`, status: 'active', maxWorkspaces: 2, createdAt: at, updatedAt: at,
});

const defaultSettings = {
  legalName: null, legalAddress: null, invoicingProvider: null, ksefSubmissionMode: 'automatic', shipxEnvironment: 'sandbox', shipxSender: null,
};

const sessionCtx = (userId: string, tenantId: string | null = null): Ctx => {
  const identity: Identity = {
    userId, email: `${userId}@example.test`, name: userId, emailVerified: true, image: null,
    tenantAccess: tenantId === null ? 'none' : 'staff', tenantId, tenantSlug: tenantId, tenantName: tenantId,
    staffRole: tenantId === null ? null : 'owner', memberId: null, memberDisplayName: null, memberBannedAt: null,
    memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
  };
  return { identity };
};

const harness = async () => {
  const fakes = createOrganizationFakes([
    { userId: 'owner-1', email: 'owner-1@example.test', emailVerified: true },
    { userId: 'admin-1', email: 'admin-1@example.test', emailVerified: true },
    { userId: 'outsider', email: 'outsider@example.test', emailVerified: true },
  ]);
  const { organizations, organizationMembers, organizationAudit } = fakes.repositories;
  await organizations.create(organization('org-1', 'holding'));
  await organizations.create(organization('org-2', 'other'));
  await organizationMembers.add('org-1', { id: 'm-1', userId: 'owner-1', role: 'owner', createdAt: at, createdByUserId: 'operator-secret' });
  await organizationMembers.add('org-1', { id: 'm-2', userId: 'admin-1', role: 'admin', createdAt: at, createdByUserId: 'owner-1' });
  await organizationMembers.add('org-2', { id: 'm-3', userId: 'outsider', role: 'owner', createdAt: at, createdByUserId: 'operator-secret' });
  await organizationAudit.record('org-1', {
    id: 'a-1', kind: 'organization.created', actorUserId: 'operator-secret', actorEmail: 'operator@together.invalid',
    actorKeyId: null, subjectTenantId: null, subjectUserId: null, data: { slug: 'holding' }, at,
  });
  const octx = async (userId: string, organizationId = 'org-1', tenantId: string | null = null) => {
    const built = await organizationContext(sessionCtx(userId, tenantId), organizationId, fakes.repositories);
    if (!built.ok) throw new Error(built.error.message);
    return built.value;
  };
  let next = 0;
  return { ...fakes.repositories, ids: { nextId: () => `id-${++next}` }, clock: { nowIso: () => later }, auditRows: fakes.auditRows, octx };
};

describe('organization reads', () => {
  it('lists only the caller memberships with their role', async () => {
    const h = await harness();
    expect(await listOrganizations(sessionCtx('admin-1'), h)).toEqual({
      ok: true, value: { organizations: [{ id: 'org-1', slug: 'holding', name: 'Organization holding', status: 'active', role: 'admin' }] },
    });
    expect(await listOrganizations(sessionCtx('nobody'), h)).toEqual({ ok: true, value: { organizations: [] } });
  });

  it('answers not_found to a non-member for the organization, its members and its audit', async () => {
    const h = await harness();
    for (const organizationId of ['org-1', 'org-missing']) {
      const octx = await h.octx('outsider', organizationId);
      expect(await getOrganization(octx, { organizationId }, h)).toEqual({ ok: false, error: { code: 'not_found', message: 'Organization not found' } });
      expect(await listOrganizationMembers(octx, { organizationId }, h)).toMatchObject({ ok: false, error: { code: 'not_found' } });
      expect(await listOrganizationAuditEvents(octx, { organizationId, limit: 25 }, h)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    }
  });

  it('ignores the workspace grant of the request when deciding organization access', async () => {
    const h = await harness();
    const octx = await h.octx('outsider', 'org-1', 'tenant-1');
    expect(await getOrganization(octx, { organizationId: 'org-1' }, h)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('lets an admin read the organization, its members and its audit', async () => {
    const h = await harness();
    const octx = await h.octx('admin-1');
    expect(await getOrganization(octx, { organizationId: 'org-1' }, h)).toEqual({
      ok: true, value: { organization: organization('org-1', 'holding'), settings: defaultSettings, role: 'admin' },
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
    const h = await harness();
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

describe('organization settings', () => {
  const sender = {
    name: 'Holding Warehouse', company: null, email: 'warehouse@example.test', phone: '500600700',
    street: 'Main', buildingNumber: '1', city: 'Warsaw', postCode: '00-001',
  };

  it('lets an owner update identity, invoicing and ShipX settings with an audit row naming only the changed fields', async () => {
    const h = await harness();
    const octx = await h.octx('owner-1');
    const result = await updateOrganization(octx, {
      organizationId: 'org-1',
      update: { name: 'Holding Group', legalName: ' Holding Ltd ', legalAddress: 'Main 1, Warsaw', invoicingProvider: 'ksef', shipxSender: sender },
    }, h);
    expect(result).toEqual({
      ok: true,
      value: {
        organization: { ...organization('org-1', 'holding'), name: 'Holding Group', updatedAt: later },
        settings: { ...defaultSettings, legalName: 'Holding Ltd', legalAddress: 'Main 1, Warsaw', invoicingProvider: 'ksef', shipxSender: sender },
        changed: true,
      },
    });
    expect(h.auditRows.at(-1)).toEqual({
      id: 'id-1', organizationId: 'org-1', kind: 'organization.updated', actorUserId: 'owner-1', actorEmail: 'owner-1@example.test',
      actorKeyId: null, subjectTenantId: null, subjectUserId: null,
      data: { fields: ['name', 'legalName', 'legalAddress', 'invoicingProvider', 'shipxSender'] }, at: later,
    });
    expect(await getOrganization(await h.octx('admin-1'), { organizationId: 'org-1' }, h)).toMatchObject({
      ok: true, value: { settings: { legalName: 'Holding Ltd', invoicingProvider: 'ksef' } },
    });
  });

  it('reports an update that changes nothing as unchanged without an audit row and clears values with null', async () => {
    const h = await harness();
    const octx = await h.octx('owner-1');
    await updateOrganization(octx, { organizationId: 'org-1', update: { legalName: 'Holding Ltd' } }, h);
    const audits = h.auditRows.length;
    expect(await updateOrganization(octx, { organizationId: 'org-1', update: { legalName: 'Holding Ltd' } }, h))
      .toMatchObject({ ok: true, value: { changed: false } });
    expect(h.auditRows).toHaveLength(audits);
    expect(await updateOrganization(octx, { organizationId: 'org-1', update: { legalName: null } }, h))
      .toMatchObject({ ok: true, value: { settings: { legalName: null }, changed: true } });
  });

  it('refuses an admin, a non-member and an empty update', async () => {
    const h = await harness();
    expect(await updateOrganization(await h.octx('admin-1'), { organizationId: 'org-1', update: { name: 'Taken' } }, h))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await updateOrganization(await h.octx('outsider'), { organizationId: 'org-1', update: { name: 'Taken' } }, h))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    const octx = await h.octx('owner-1');
    expect(await updateOrganization(octx, { organizationId: 'org-1', update: {} }, h))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.auditRows.map((event) => event.kind)).toEqual(['organization.created']);
  });
});
