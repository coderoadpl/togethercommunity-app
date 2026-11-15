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
  organizationSecretsOutputSchema,
  organizationUpdateOutputSchema,
  organizationWorkspaceChangeOutputSchema,
  organizationWorkspaceSourcesOutputSchema,
  organizationWorkspacesOutputSchema,
} from '#core/contract/index.js';
import { ok, staffGrantSourceSchema, staffRoleSchema, type Identity } from '#core/domain/index.js';
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
    const tenantId = c.req.header('x-test-tenant');
    const staffRole = staffRoleSchema.safeParse(c.req.header('x-test-role'));
    const source = staffGrantSourceSchema.safeParse(c.req.header('x-test-source'));
    const base = identity(c.req.header('x-test-user') ?? 'anonymous');
    c.set('identity', tenantId === undefined || !staffRole.success ? base : {
      ...base, tenantAccess: 'staff', tenantId, tenantSlug: tenantId, tenantName: tenantId, staffRole: staffRole.data,
      ...(source.success ? { staffGrantSource: source.data } : {}),
    });
    await next();
  });
  const secretCrypto = {
    encrypt: (plaintext: string) => ({ ciphertext: `cipher:${plaintext}`, iv: 'iv-value', authTag: 'tag-value' }),
    decrypt: (input: { ciphertext: string }) => ok(input.ciphertext.replace('cipher:', '')),
  };
  registerOrganizationRoutes(app, { ...fakes.repositories, authPort: fakes.authPort, secretCrypto, ids, clock });
  const create = (ownerEmail: string, headers: Record<string, string> = operatorHeaders) =>
    app.request(API_PATHS.operatorOrganizationCreate, { method: 'POST', headers, body: createBody(ownerEmail) });
  const read = (path: string, userId: string) => app.request(path, { headers: { 'x-test-user': userId } });
  const post = (path: string, userId: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: { 'x-test-user': userId, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const remove = (path: string, userId: string) => app.request(path, { method: 'DELETE', headers: { 'x-test-user': userId } });
  return { ...fakes, app, create, read, post, remove };
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
      .toMatchObject({ ok: true, data: { organization: { id: organizationId }, settings: { legalName: null, shipxEnvironment: 'sandbox' }, role: 'admin' } });
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
    const overLimit = await h.post(path(API_PATHS.organizationWorkspaceLink), 'owner-1', { tenantId: 'acme' });
    expect(overLimit.status).toBe(409);
    expect(await overLimit.json()).toMatchObject({ ok: false, error: { code: 'workspace_quota_exceeded' } });
    expect(h.tenantAuditRows).toEqual([]);
    const raised = await h.app.request(path(API_PATHS.operatorOrganizationLimits), {
      method: 'POST', headers: operatorHeaders, body: JSON.stringify({ maxWorkspaces: 1 }),
    });
    expect(raised.status).toBe(200);
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

  it('updates organization settings for an owner and validates the payload', async () => {
    const h = harness();
    const organizationId = await created(h);
    const path = API_PATHS.organizationUpdate.replace(':organizationId', organizationId);
    expect((await h.post(path, 'admin-1', { legalName: 'Holding Ltd' })).status).toBe(403);
    expect((await h.post(path, 'other-1', { legalName: 'Holding Ltd' })).status).toBe(404);
    for (const body of [{}, { invoicingProvider: 'other' }, { shipxEnvironment: 'staging' }, { slug: 'renamed' }, { maxWorkspaces: 9 }]) {
      expect((await h.post(path, 'owner-1', body)).status, JSON.stringify(body)).toBe(400);
    }
    const updated = await h.post(path, 'owner-1', { legalName: 'Holding Ltd', ksefSubmissionMode: 'manual' });
    expect(envelopeSchema(organizationUpdateOutputSchema).parse(await updated.json())).toMatchObject({
      ok: true, data: { settings: { legalName: 'Holding Ltd', ksefSubmissionMode: 'manual' }, changed: true },
    });
    expect(h.auditRows.at(-1)).toMatchObject({ kind: 'organization.updated', data: { fields: ['legalName', 'ksefSubmissionMode'] } });
  });

  it('sets, lists and deletes organization secrets without ever returning stored ciphertext', async () => {
    const h = harness();
    const organizationId = await created(h);
    const secrets = API_PATHS.organizationSecrets.replace(':organizationId', organizationId);
    const secretPath = (key: string) => API_PATHS.organizationSecretDelete.replace(':organizationId', organizationId).replace(':key', key);
    expect((await h.post(secrets, 'admin-1', { key: 'smtp.password', value: 'smtp-secret-1234' })).status).toBe(403);
    for (const key of ['stripe.webhookSecret', 's3.accessKeyId', 'stripe.restrictedKey', 'telemetry.mongodb', 'bunny.apiKey']) {
      const refused = await h.post(secrets, 'owner-1', { key, value: 'secret-value-1234' });
      expect(refused.status, key).toBe(400);
      expect(JSON.stringify(await refused.json()), key).not.toContain('secret-value-1234');
    }
    const stored = await h.post(secrets, 'owner-1', { key: 'smtp.password', value: 'smtp-secret-1234' });
    expect(await stored.json()).toEqual({ ok: true, data: { secret: { key: 'smtp.password', maskedPreview: '••••1234', updatedAt: '2026-11-15T12:00:00.000Z' } } });
    const listed = await h.read(secrets, 'admin-1');
    const listedText = await listed.text();
    expect(envelopeSchema(organizationSecretsOutputSchema).parse(JSON.parse(listedText))).toEqual({
      ok: true, data: { secrets: [{ key: 'smtp.password', maskedPreview: '••••1234', updatedAt: '2026-11-15T12:00:00.000Z' }] },
    });
    expect(listedText).not.toMatch(/cipher|iv-value|tag-value|smtp-secret|ciphertext|authTag/);
    expect((await h.remove(secretPath('s3.accessKeyId'), 'owner-1')).status).toBe(400);
    expect((await h.remove(secretPath('smtp.password'), 'admin-1')).status).toBe(403);
    expect(await (await h.remove(secretPath('smtp.password'), 'owner-1')).json()).toEqual({ ok: true, data: { key: 'smtp.password' } });
    expect((await h.remove(secretPath('smtp.password'), 'owner-1')).status).toBe(404);
    expect(h.auditRows.map((event) => event.kind).slice(-2)).toEqual(['secret.set', 'secret.deleted']);
    expect(JSON.stringify(h.auditRows)).not.toMatch(/smtp-secret|cipher/);
  });

  it('unlinks the active workspace for a direct owner only and keeps the organization route open to an organization owner', async () => {
    const h = harness();
    const organizationId = await created(h);
    const limits = API_PATHS.operatorOrganizationLimits.replace(':organizationId', organizationId);
    expect((await h.app.request(limits, { method: 'POST', headers: operatorHeaders, body: JSON.stringify({ maxWorkspaces: 1 }) })).status).toBe(200);
    const link = () => h.post(API_PATHS.organizationWorkspaceLink.replace(':organizationId', organizationId), 'owner-1', { tenantId: 'acme' });
    const unlinkAsStaff = (userId: string, role: string, source: string) => h.app.request(API_PATHS.tenantOrganizationUnlink, {
      method: 'POST',
      headers: { 'x-test-user': userId, 'x-test-tenant': 'acme', 'x-test-role': role, 'x-test-source': source, 'content-type': 'application/json' },
      body: '{}',
    });
    expect((await link()).status).toBe(200);

    expect((await unlinkAsStaff('other-1', 'owner', 'organization')).status).toBe(403);
    expect((await unlinkAsStaff('admin-1', 'admin', 'direct')).status).toBe(403);
    const unlinked = await unlinkAsStaff('admin-1', 'owner', 'direct');
    expect(envelopeSchema(organizationWorkspaceChangeOutputSchema).parse(await unlinked.json()))
      .toEqual({ ok: true, data: { workspace: { id: 'acme', slug: 'acme', name: 'Acme', status: 'active' }, changed: true } });
    expect(h.workspaceRows.find((row) => row.id === 'acme')?.organizationId).toBeNull();
    expect(h.tenantAuditRows.map(({ kind, actorUserId, reason }) => [kind, actorUserId, reason])).toEqual([
      ['organization.linked', 'owner-1', organizationId], ['organization.unlinked', 'admin-1', organizationId],
    ]);

    expect((await link()).status).toBe(200);
    h.configSourceRows.push({ tenantId: 'acme', group: 'telemetry', source: 'organization', updatedAt: '2026-11-15T12:00:00.000Z', updatedByUserId: 'owner-1' });
    expect((await unlinkAsStaff('admin-1', 'owner', 'direct')).status).toBe(409);
    expect((await h.post(API_PATHS.organizationWorkspaceUnlink.replace(':organizationId', organizationId), 'owner-1', { tenantId: 'acme' })).status).toBe(409);
    expect(h.workspaceRows.find((row) => row.id === 'acme')?.organizationId).toBe(organizationId);
  });

  it('refuses to delete a secret whose group a linked workspace inherits and reads the workspace sources', async () => {
    const h = harness();
    const organizationId = await created(h);
    const limits = API_PATHS.operatorOrganizationLimits.replace(':organizationId', organizationId);
    expect((await h.app.request(limits, { method: 'POST', headers: operatorHeaders, body: JSON.stringify({ maxWorkspaces: 1 }) })).status).toBe(200);
    await h.post(API_PATHS.organizationWorkspaceLink.replace(':organizationId', organizationId), 'owner-1', { tenantId: 'acme' });
    await h.post(API_PATHS.organizationSecrets.replace(':organizationId', organizationId), 'owner-1', { key: 'ksef.token', value: 'ksef-token-5678' });
    h.configSourceRows.push({ tenantId: 'acme', group: 'invoicing', source: 'organization', updatedAt: '2026-11-15T12:00:00.000Z', updatedByUserId: 'owner-1' });
    const refused = await h.remove(API_PATHS.organizationSecretDelete.replace(':organizationId', organizationId).replace(':key', 'ksef.token'), 'owner-1');
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(h.secretRows.map((row) => row.key)).toEqual(['ksef.token']);
    const sourcesPath = (tenantId: string) =>
      API_PATHS.organizationWorkspaceSources.replace(':organizationId', organizationId).replace(':tenantId', tenantId);
    const sources = envelopeSchema(organizationWorkspaceSourcesOutputSchema).parse(await (await h.read(sourcesPath('acme'), 'admin-1')).json());
    expect(sources.ok && sources.data.sources.map(({ group, source }) => `${group}:${source}`)).toEqual([
      'payments_live:workspace', 'payments_test:workspace', 'invoicing:organization',
      'email_transport:workspace', 'telemetry:workspace', 'shipping_carrier:workspace',
    ]);
    expect((await h.read(sourcesPath('studio'), 'admin-1')).status).toBe(404);
    expect((await h.read(sourcesPath('acme'), 'other-1')).status).toBe(404);
  });
});

describe('suspended organization routes', () => {
  it('refuses session writes, keeps session reads and operator limits, and accepts writes again after reactivation', async () => {
    const h = harness();
    const organizationId = await created(h);
    const path = (template: string) => template.replace(':organizationId', organizationId);
    const setStatus = (status: 'active' | 'suspended') => {
      for (const row of h.organizationRows) if (row.id === organizationId) row.status = status;
    };
    setStatus('suspended');

    const limits = await h.app.request(path(API_PATHS.operatorOrganizationLimits), {
      method: 'POST', headers: operatorHeaders, body: JSON.stringify({ maxWorkspaces: 2 }),
    });
    expect(limits.status).toBe(200);
    expect(await limits.json()).toMatchObject({ ok: true, data: { organization: { maxWorkspaces: 2, status: 'suspended' } } });

    const refusal = { ok: false, error: { code: 'forbidden', message: 'This organization is suspended; only reads are allowed until it is reactivated' } };
    for (const response of [
      await h.post(path(API_PATHS.organizationUpdate), 'owner-1', { legalName: 'Holding Ltd' }),
      await h.post(path(API_PATHS.organizationWorkspaceLink), 'owner-1', { tenantId: 'acme' }),
      await h.post(path(API_PATHS.organizationMemberRemove), 'owner-1', { email: 'admin-1@example.test' }),
      await h.post(path(API_PATHS.organizationSecrets), 'owner-1', { key: 'ifirma.invoiceApiKey', value: 'invoice-secret-abcd' }),
      await h.remove(path(API_PATHS.organizationSecretDelete).replace(':key', 'ifirma.invoiceApiKey'), 'owner-1'),
    ]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(refusal);
    }
    expect(h.workspaceRows.map(({ organizationId: linked }) => linked)).toEqual([null]);

    expect(envelopeSchema(organizationOutputSchema).parse(await (await h.read(path(API_PATHS.organization), 'admin-1')).json()))
      .toMatchObject({ ok: true, data: { organization: { id: organizationId, status: 'suspended' }, role: 'admin' } });
    for (const template of [API_PATHS.organizationMembers, API_PATHS.organizationWorkspaces, API_PATHS.organizationSecrets, API_PATHS.organizationAuditEvents]) {
      expect((await h.read(path(template), 'owner-1')).status, template).toBe(200);
    }

    setStatus('active');
    const linked = await h.post(path(API_PATHS.organizationWorkspaceLink), 'owner-1', { tenantId: 'acme' });
    expect(envelopeSchema(organizationWorkspaceChangeOutputSchema).parse(await linked.json()))
      .toMatchObject({ ok: true, data: { workspace: { id: 'acme' }, changed: true } });
  });
});
