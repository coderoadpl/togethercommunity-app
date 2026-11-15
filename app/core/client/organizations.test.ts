import { describe, expect, it } from 'vitest';

import { SCHEDULER_OPERATOR_SECRET_HEADER } from '#core/contract/index.js';
import type { Organization } from '#core/domain/index.js';

import { createApiClient } from './http.js';

const organization: Organization = {
  id: 'org-1', slug: 'holding', name: 'Holding', status: 'active', maxWorkspaces: 2,
  createdAt: '2026-11-15T12:00:00.000Z', updatedAt: '2026-11-15T12:00:00.000Z',
};

const settings = {
  legalName: 'Holding Ltd', legalAddress: null, invoicingProvider: 'ifirma', ksefSubmissionMode: 'automatic', shipxEnvironment: 'sandbox', shipxSender: null,
};

const recordingClient = (data: unknown) => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const api = createApiClient({
    baseUrl: 'http://localhost:48730',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ ok: true, data });
    },
  });
  return { api, calls };
};

describe('organization client', () => {
  it('sends the operator secret only in its header for create and limits', async () => {
    const { api, calls } = recordingClient({ organization, created: true, ownerUserId: 'owner-1' });
    expect(await api.operatorCreateOrganization({ slug: 'holding', name: 'Holding', ownerEmail: 'owner@example.test' }, 'hidden'))
      .toEqual({ ok: true, value: { organization, created: true, ownerUserId: 'owner-1' } });
    const limits = recordingClient({ organization });
    expect(await limits.api.operatorSetOrganizationLimits({ organizationId: 'org/1', maxWorkspaces: 2 }, 'hidden'))
      .toEqual({ ok: true, value: { organization } });
    const all = [...calls, ...limits.calls];
    expect(all.map((call) => [call.init?.method, call.url])).toEqual([
      ['POST', 'http://localhost:48730/api/internal/organizations'],
      ['POST', 'http://localhost:48730/api/internal/organizations/org%2F1/limits'],
    ]);
    expect(limits.calls[0]?.init?.body).toBe(JSON.stringify({ maxWorkspaces: 2 }));
    for (const call of all) {
      expect(new Headers(call.init?.headers).get(SCHEDULER_OPERATOR_SECRET_HEADER)).toBe('hidden');
      expect(`${call.url}${String(call.init?.body)}`).not.toContain('hidden');
    }
  });

  it('reads organizations, members and audit events from their session routes', async () => {
    const list = recordingClient({ organizations: [{ id: 'org-1', slug: 'holding', name: 'Holding', status: 'active', role: 'admin' }] });
    expect(await list.api.listOrganizations()).toMatchObject({ ok: true, value: { organizations: [{ role: 'admin' }] } });
    const show = recordingClient({ organization, settings, role: 'admin' });
    expect(await show.api.getOrganization({ organizationId: 'org-1' })).toEqual({ ok: true, value: { organization, settings, role: 'admin' } });
    const members = recordingClient({ members: [] });
    expect(await members.api.listOrganizationMembers({ organizationId: 'org-1' })).toEqual({ ok: true, value: { members: [] } });
    const audit = recordingClient({ events: [] });
    expect(await audit.api.listOrganizationAuditEvents({ organizationId: 'org-1', limit: 5 })).toEqual({ ok: true, value: { events: [] } });
    expect([list, show, members, audit].map(({ calls }) => calls[0]?.url)).toEqual([
      'http://localhost:48730/api/organizations',
      'http://localhost:48730/api/organizations/org-1',
      'http://localhost:48730/api/organizations/org-1/members',
      'http://localhost:48730/api/organizations/org-1/audit-events?limit=5',
    ]);
    for (const { calls } of [list, show, members, audit]) {
      expect(new Headers(calls[0]?.init?.headers).has(SCHEDULER_OPERATOR_SECRET_HEADER)).toBe(false);
    }
  });

  it('lists, links and unlinks workspaces with the workspace id in the body', async () => {
    const workspace = { id: 'acme', slug: 'acme', name: 'Acme', status: 'active' };
    const list = recordingClient({ workspaces: [workspace] });
    expect(await list.api.listOrganizationWorkspaces({ organizationId: 'org-1' })).toEqual({ ok: true, value: { workspaces: [workspace] } });
    const link = recordingClient({ workspace, changed: true });
    expect(await link.api.linkOrganizationWorkspace({ organizationId: 'org-1', tenantId: 'acme' })).toEqual({ ok: true, value: { workspace, changed: true } });
    const unlink = recordingClient({ workspace, changed: false });
    expect(await unlink.api.unlinkOrganizationWorkspace({ organizationId: 'org-1', tenantId: 'acme' })).toEqual({ ok: true, value: { workspace, changed: false } });
    expect([list, link, unlink].map(({ calls }) => [calls[0]?.init?.method, calls[0]?.url, calls[0]?.init?.body])).toEqual([
      ['GET', 'http://localhost:48730/api/organizations/org-1/workspaces', null],
      ['POST', 'http://localhost:48730/api/organizations/org-1/workspaces/link', JSON.stringify({ tenantId: 'acme' })],
      ['POST', 'http://localhost:48730/api/organizations/org-1/workspaces/unlink', JSON.stringify({ tenantId: 'acme' })],
    ]);
  });

  it('adds, re-roles and removes members with the e-mail address in the body', async () => {
    const member = { userId: 'user-1', email: 'member@example.test', role: 'admin', createdAt: '2026-11-15T12:00:00.000Z' };
    const add = recordingClient({ member, changed: true });
    expect(await add.api.addOrganizationMember({ organizationId: 'org/1', email: 'member@example.test', role: 'admin' }))
      .toEqual({ ok: true, value: { member, changed: true } });
    const role = recordingClient({ member: { ...member, role: 'owner' }, changed: true });
    expect(await role.api.setOrganizationMemberRole({ organizationId: 'org-1', email: 'member@example.test', role: 'owner' }))
      .toMatchObject({ ok: true, value: { member: { role: 'owner' } } });
    const remove = recordingClient({ member, changed: true });
    expect(await remove.api.removeOrganizationMember({ organizationId: 'org-1', email: 'member@example.test' }))
      .toEqual({ ok: true, value: { member, changed: true } });
    expect([add, role, remove].map(({ calls }) => [calls[0]?.init?.method, calls[0]?.url, calls[0]?.init?.body])).toEqual([
      ['POST', 'http://localhost:48730/api/organizations/org%2F1/members', JSON.stringify({ email: 'member@example.test', role: 'admin' })],
      ['POST', 'http://localhost:48730/api/organizations/org-1/members/role', JSON.stringify({ email: 'member@example.test', role: 'owner' })],
      ['POST', 'http://localhost:48730/api/organizations/org-1/members/remove', JSON.stringify({ email: 'member@example.test' })],
    ]);
  });

  it('updates settings and manages secrets and sources on their organization routes, with the secret only in the body', async () => {
    const update = recordingClient({ organization, settings, changed: true });
    expect(await update.api.updateOrganization({ organizationId: 'org/1', update: { legalName: 'Holding Ltd', invoicingProvider: 'ifirma' } }))
      .toEqual({ ok: true, value: { organization, settings, changed: true } });
    const secret = { key: 'ifirma.invoiceApiKey', maskedPreview: '••••cdef', updatedAt: '2026-11-15T12:00:00.000Z' };
    const list = recordingClient({ secrets: [secret] });
    expect(await list.api.listOrganizationSecrets({ organizationId: 'org-1' })).toEqual({ ok: true, value: { secrets: [secret] } });
    const set = recordingClient({ secret });
    expect(await set.api.setOrganizationSecret({ organizationId: 'org-1', key: 'ifirma.invoiceApiKey', value: 'hidden-abcdef' }))
      .toEqual({ ok: true, value: { secret } });
    const remove = recordingClient({ key: 'ifirma.invoiceApiKey' });
    expect(await remove.api.deleteOrganizationSecret({ organizationId: 'org-1', key: 'ifirma.invoiceApiKey' }))
      .toEqual({ ok: true, value: { key: 'ifirma.invoiceApiKey' } });
    const sources = recordingClient({
      workspace: { id: 'acme', slug: 'acme', name: 'Acme', status: 'active' },
      sources: [{ group: 'invoicing', source: 'organization', updatedAt: '2026-11-15T12:00:00.000Z', updatedByUserId: 'owner-1' }],
    });
    expect(await sources.api.getWorkspaceConfigSources({ organizationId: 'org-1', tenantId: 'acme/x' }))
      .toMatchObject({ ok: true, value: { sources: [{ group: 'invoicing', source: 'organization' }] } });
    expect([update, list, set, remove, sources].map(({ calls }) => [calls[0]?.init?.method, calls[0]?.url, calls[0]?.init?.body])).toEqual([
      ['POST', 'http://localhost:48730/api/organizations/org%2F1/update', JSON.stringify({ legalName: 'Holding Ltd', invoicingProvider: 'ifirma' })],
      ['GET', 'http://localhost:48730/api/organizations/org-1/secrets', null],
      ['POST', 'http://localhost:48730/api/organizations/org-1/secrets', JSON.stringify({ key: 'ifirma.invoiceApiKey', value: 'hidden-abcdef' })],
      ['DELETE', 'http://localhost:48730/api/organizations/org-1/secrets/ifirma.invoiceApiKey', null],
      ['GET', 'http://localhost:48730/api/organizations/org-1/workspaces/acme%2Fx/sources', null],
    ]);
    expect(set.calls[0]?.url).not.toContain('hidden');
  });
});
