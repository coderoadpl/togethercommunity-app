import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  API_PATHS,
  SCHEDULER_OPERATOR_SECRET_HEADER,
  envelopeSchema,
  operatorCreateOrganizationOutputSchema,
  organizationAuditEventsOutputSchema,
  organizationListOutputSchema,
  organizationMemberChangeOutputSchema,
  organizationMembersOutputSchema,
  organizationOutputSchema,
  organizationWorkspaceChangeOutputSchema,
  organizationWorkspacesOutputSchema,
} from '#core/contract/index.js';
import type { Identity } from '#core/domain/index.js';
import { createOrganizationFakes } from '#core/server/testing/organization-fakes.js';

import type { AppVars } from './app-vars.js';
import { registerOperatorOrganizationRoutes, registerOrganizationRoutes } from './organization-routes.js';

const secret = 'operator-test-only-secret';
const operatorHeaders = { [SCHEDULER_OPERATOR_SECRET_HEADER]: secret, 'content-type': 'application/json' };
const createBody = (ownerEmail: string) => JSON.stringify({ slug: 'holding', name: 'Holding', ownerEmail });

const identity = (userId: string): Identity => ({
  userId, email: `${userId}@example.test`, name: userId, emailVerified: true, image: null,
  tenantAccess: 'none', tenantId: null, tenantSlug: null, tenantName: null, staffRole: null, memberId: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
});

const harness = () => {
  const fakes = createOrganizationFakes([
    { userId: 'owner-1', email: 'owner-1@example.test', emailVerified: true },
    { userId: 'admin-1', email: 'admin-1@example.test', emailVerified: true },
    { userId: 'other-1', email: 'other-1@example.test', emailVerified: true },
    { userId: 'unverified-1', email: 'unverified-1@example.test', emailVerified: false },
  ], [
    { id: 'acme', slug: 'acme', name: 'Acme', status: 'active', organizationId: null, grants: [{ userId: 'owner-1', role: 'owner' }, { userId: 'admin-1', role: 'owner' }] },
  ]);
  let nextId = 0;
  const ids = { nextId: () => `id-${++nextId}` };
  const clock = { nowIso: () => '2026-11-15T12:00:00.000Z' };
  const app = new Hono<AppVars>();
  registerOperatorOrganizationRoutes(app, {
    ...fakes.repositories,
    authPort: fakes.authPort,
    ids,
    clock,
    operatorSecret: secret,
  });
  app.use('/api/*', async (c, next) => {
    c.set('identity', identity(c.req.header('x-test-user') ?? 'anonymous'));
    await next();
  });
  registerOrganizationRoutes(app, { ...fakes.repositories, authPort: fakes.authPort, ids, clock });
  const create = (ownerEmail: string, headers: Record<string, string> = operatorHeaders) =>
    app.request(API_PATHS.operatorOrganizationCreate, { method: 'POST', headers, body: createBody(ownerEmail) });
  const read = (path: string, userId: string) => app.request(path, { headers: { 'x-test-user': userId } });
  const post = (path: string, userId: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: { 'x-test-user': userId, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ...fakes, app, create, read, post };
};

const created = async (h: ReturnType<typeof harness>) => {
  const response = await h.create('owner-1@example.test');
  const payload = envelopeSchema(operatorCreateOrganizationOutputSchema).parse(await response.json());
  if (!payload.ok) throw new Error(payload.error.message);
  await h.repositories.organizationMembers.add(payload.data.organization.id, {
    id: 'member-admin', userId: 'admin-1', role: 'admin', createdAt: '2026-11-15T12:00:00.000Z', createdByUserId: 'owner-1',
  });
  return payload.data.organization.id;
};

describe('operator organization routes', () => {
  it.each([{}, { [SCHEDULER_OPERATOR_SECRET_HEADER]: 'wrong-secret' }])('rejects an invalid secret before reading the payload', async (headers) => {
    const h = harness();
    expect((await h.create('owner-1@example.test', headers)).status).toBe(401);
    const limits = API_PATHS.operatorOrganizationLimits.replace(':organizationId', 'id-1');
    expect((await h.app.request(limits, { method: 'POST', headers, body: JSON.stringify({ maxWorkspaces: 1 }) })).status).toBe(401);
    expect(h.organizationRows).toEqual([]);
  });

  it('creates once, replays for the same owner and conflicts for another owner', async () => {
    const h = harness();
    const first = envelopeSchema(operatorCreateOrganizationOutputSchema).parse(await (await h.create('owner-1@example.test')).json());
    const replay = envelopeSchema(operatorCreateOrganizationOutputSchema).parse(await (await h.create('owner-1@example.test')).json());
    expect(first).toMatchObject({ ok: true, data: { created: true, ownerUserId: 'owner-1', organization: { slug: 'holding', maxWorkspaces: 0 } } });
    expect(replay).toMatchObject({ ok: true, data: { created: false, ownerUserId: 'owner-1' } });
    const conflict = await h.create('other-1@example.test');
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(h.organizationRows).toHaveLength(1);
    expect(h.auditRows.map((event) => event.kind)).toEqual(['organization.created', 'member.added']);
  });

  it.each(['missing@example.test', 'unverified-1@example.test'])('refuses the owner %s', async (ownerEmail) => {
    const h = harness();
    const response = await h.create(ownerEmail);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'validation', message: 'Owner account not found or not verified' } });
    expect(h.organizationRows).toEqual([]);
  });

  it('sets the workspace limit', async () => {
    const h = harness();
    const organizationId = await created(h);
    const response = await h.app.request(API_PATHS.operatorOrganizationLimits.replace(':organizationId', organizationId), {
      method: 'POST', headers: operatorHeaders, body: JSON.stringify({ maxWorkspaces: 4 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: { organization: { id: organizationId, maxWorkspaces: 4 } } });
  });
});

describe('organization session routes', () => {
  it('answers 404 not_found to a non-member for an existing and an unknown organization', async () => {
    const h = harness();
    const organizationId = await created(h);
    for (const id of [organizationId, 'unknown-organization']) {
      for (const path of [API_PATHS.organization, API_PATHS.organizationMembers, API_PATHS.organizationAuditEvents]) {
        const response = await h.read(path.replace(':organizationId', id), 'other-1');
        expect(response.status, path).toBe(404);
        expect(await response.json(), path).toEqual({ ok: false, error: { code: 'not_found', message: 'Organization not found' } });
      }
    }
    expect(envelopeSchema(organizationListOutputSchema).parse(await (await h.read(API_PATHS.organizations, 'other-1')).json()))
      .toEqual({ ok: true, data: { organizations: [] } });
  });

  it('lets an admin read the organization, its members and its audit', async () => {
    const h = harness();
    const organizationId = await created(h);
    const path = (template: string) => template.replace(':organizationId', organizationId);
    expect(envelopeSchema(organizationListOutputSchema).parse(await (await h.read(API_PATHS.organizations, 'admin-1')).json()))
      .toMatchObject({ ok: true, data: { organizations: [{ id: organizationId, slug: 'holding', role: 'admin' }] } });
    expect(envelopeSchema(organizationOutputSchema).parse(await (await h.read(path(API_PATHS.organization), 'admin-1')).json()))
      .toMatchObject({ ok: true, data: { organization: { id: organizationId }, role: 'admin' } });
    expect(envelopeSchema(organizationMembersOutputSchema).parse(await (await h.read(path(API_PATHS.organizationMembers), 'admin-1')).json()))
      .toMatchObject({ ok: true, data: { members: [{ email: 'owner-1@example.test', role: 'owner' }, { email: 'admin-1@example.test', role: 'admin' }] } });
    const audit = await h.read(`${path(API_PATHS.organizationAuditEvents)}?limit=1`, 'admin-1');
    expect(envelopeSchema(organizationAuditEventsOutputSchema).parse(await audit.json()))
      .toMatchObject({ ok: true, data: { events: [{ organizationId }] } });
    expect((await h.read(`${path(API_PATHS.organizationAuditEvents)}?limit=0`, 'admin-1')).status).toBe(400);
  });

  it('links, lists and unlinks a workspace for an owner and refuses an admin', async () => {
    const h = harness();
    const organizationId = await created(h);
    const path = (template: string) => template.replace(':organizationId', organizationId);
    const refused = await h.post(path(API_PATHS.organizationWorkspaceLink), 'admin-1', { tenantId: 'acme' });
    expect(refused.status).toBe(403);
    expect((await h.post(path(API_PATHS.organizationWorkspaceLink), 'owner-1', { tenantId: '' })).status).toBe(400);
    expect((await h.post(path(API_PATHS.organizationWorkspaceLink), 'other-1', { tenantId: 'acme' })).status).toBe(404);
    const linked = await h.post(path(API_PATHS.organizationWorkspaceLink), 'owner-1', { tenantId: 'acme' });
    expect(envelopeSchema(organizationWorkspaceChangeOutputSchema).parse(await linked.json()))
      .toEqual({ ok: true, data: { workspace: { id: 'acme', slug: 'acme', name: 'Acme', status: 'active' }, changed: true } });
    expect(envelopeSchema(organizationWorkspacesOutputSchema).parse(await (await h.read(path(API_PATHS.organizationWorkspaces), 'admin-1')).json()))
      .toEqual({ ok: true, data: { workspaces: [{ id: 'acme', slug: 'acme', name: 'Acme', status: 'active' }] } });
    const unlinked = await h.post(path(API_PATHS.organizationWorkspaceUnlink), 'owner-1', { tenantId: 'acme' });
    expect(envelopeSchema(organizationWorkspaceChangeOutputSchema).parse(await unlinked.json())).toMatchObject({ ok: true, data: { changed: true } });
    expect(h.auditRows.map((event) => event.kind).slice(-2)).toEqual(['workspace.linked', 'workspace.unlinked']);
    expect(h.tenantAuditRows.map((event) => event.kind)).toEqual(['organization.linked', 'organization.unlinked']);
  });

  it('adds, re-roles and removes members for an owner, refuses an admin and protects the last owner', async () => {
    const h = harness();
    const organizationId = await created(h);
    const path = (template: string) => template.replace(':organizationId', organizationId);
    const refused = await h.post(path(API_PATHS.organizationMemberAdd), 'admin-1', { email: 'other-1@example.test', role: 'admin' });
    expect(refused.status).toBe(403);
    expect((await h.post(path(API_PATHS.organizationMemberAdd), 'owner-1', { email: 'other-1@example.test', role: 'member' })).status).toBe(400);
    expect((await h.post(path(API_PATHS.organizationMemberAdd), 'other-1', { email: 'other-1@example.test', role: 'owner' })).status).toBe(404);
    expect((await h.post(path(API_PATHS.organizationMemberAdd), 'owner-1', { email: 'unverified-1@example.test', role: 'admin' })).status).toBe(400);
    const added = await h.post(path(API_PATHS.organizationMemberAdd), 'owner-1', { email: 'other-1@example.test', role: 'owner' });
    expect(envelopeSchema(organizationMemberChangeOutputSchema).parse(await added.json())).toEqual({
      ok: true, data: { member: { userId: 'other-1', email: 'other-1@example.test', role: 'owner', createdAt: '2026-11-15T12:00:00.000Z' }, changed: true },
    });
    const demoted = await h.post(path(API_PATHS.organizationMemberRole), 'other-1', { email: 'owner-1@example.test', role: 'admin' });
    expect(envelopeSchema(organizationMemberChangeOutputSchema).parse(await demoted.json()))
      .toMatchObject({ ok: true, data: { member: { userId: 'owner-1', role: 'admin' }, changed: true } });
    const lastOwner = await h.post(path(API_PATHS.organizationMemberRemove), 'other-1', { email: 'other-1@example.test' });
    expect(lastOwner.status).toBe(409);
    expect(await lastOwner.json()).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect((await h.post(path(API_PATHS.organizationMemberRole), 'other-1', { email: 'other-1@example.test', role: 'admin' })).status).toBe(409);
    await h.post(path(API_PATHS.organizationMemberRole), 'other-1', { email: 'owner-1@example.test', role: 'owner' });
    expect((await h.read(path(API_PATHS.organization), 'other-1')).status).toBe(200);
    const removed = await h.post(path(API_PATHS.organizationMemberRemove), 'owner-1', { email: 'other-1@example.test' });
    expect(envelopeSchema(organizationMemberChangeOutputSchema).parse(await removed.json()))
      .toMatchObject({ ok: true, data: { member: { userId: 'other-1', role: 'owner' }, changed: true } });
    for (const template of [API_PATHS.organization, API_PATHS.organizationMembers]) {
      const response = await h.read(path(template), 'other-1');
      expect(response.status, template).toBe(404);
      expect(await response.json(), template).toEqual({ ok: false, error: { code: 'not_found', message: 'Organization not found' } });
    }
    expect(h.auditRows.map((event) => event.kind).slice(2)).toEqual([
      'member.added', 'member.role_changed', 'member.role_changed', 'member.removed',
    ]);
  });
});
