import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { members, organizationMembers, organizations, tenantAdmins, tenants } from '#adapters/db/schema.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import {
  API_KEY_HEADER,
  API_ROUTES,
  SCHEDULER_OPERATOR_SECRET_HEADER,
  apiKeyCreateOutputSchema,
  apiKeysShopManagementCreateOutputSchema,
  signInClientCredentialSchema,
  signInClientDisableOutputSchema,
  signInClientPageSchema,
} from '#core/contract/index.js';
import type { SignInClientCredential, TenantApiKeyScope } from '#core/domain/index.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';
import { publicRouteManifestEntry } from './public-route-manifest.js';
import { requestOriginPolicy } from './request-origin-policy.js';

const baseUrl = 'http://localhost:48730';
const workspaceOrigin = 'http://acme.localhost:48730';
const operatorSecret = 'registry-test-operator-secret';
const password = 'registry-session-password';
const now = '2026-11-27T12:00:00.000Z';
const allowed = 'acme=callback.example.test,acme=browser.example.test';
const input = { name: 'External application', redirectUris: ['https://callback.example.test/Return%2Fvalue'] };
const browserInput = { name: 'Browser test client', redirectUris: ['https://browser.example.test/return'] };
const accountKinds = ['owner', 'admin', 'member', 'foreign', 'derived', 'unverified'] as const;
type AccountKind = (typeof accountKinds)[number];
type Session = { id: string; cookie: string; bearer: string };

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let deps: ReturnType<typeof createDeps>;
let pending: SignInClientCredential;
let impersonation: string;
const sessions = new Map<AccountKind, Session>();
const machineCredentials = new Map<string, Record<string, string>>();

const setup = (hosts = '') => createDeps(envSchema.parse({
  NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
  APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost', OPERATOR_SECRET: operatorSecret,
  AUTH_TRUSTED_PROXY_HEADER: 'x-test-client-ip',
  BETTER_AUTH_SECRET: 'registry-test-signing-secret-at-least-32-characters', SIGN_IN_CLIENT_HOSTS: hosts,
}), { db: database.db, clock: { nowIso: () => now } });

const session = (kind: AccountKind): Session => {
  const found = sessions.get(kind);
  if (found === undefined) throw new Error(`Missing test session: ${kind}`);
  return found;
};

const request = (target: typeof app, method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  target.request(`${workspaceOrigin}${path}`, {
    method,
    headers: { host: new URL(workspaceOrigin).host, ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const owner = () => ({ authorization: `Bearer ${session('owner').bearer}` });
const data = async <T>(response: Response, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> =>
  schema.parse(z.object({ ok: z.literal(true), data: z.unknown() }).parse(await response.json()).data);

const authRequest = (kind: AccountKind, path: string, body: unknown) => app.request(`${baseUrl}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: baseUrl, 'x-test-client-ip': `192.0.2.${accountKinds.indexOf(kind) + 1}` },
  body: JSON.stringify(body),
});

const createSession = async (kind: AccountKind): Promise<Session> => {
  const email = `registry-${kind}@example.test`;
  const signup = await authRequest(kind, BETTER_AUTH_SIGN_UP_PATH, { name: kind, email, password });
  expect(signup.status).toBe(200);
  const { user: { id } } = z.object({ user: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]+$/u) }) }).parse(await signup.json());
  if (kind !== 'unverified') await database.db.execute(`update "user" set email_verified = true where id = '${id}'`);
  const signin = await authRequest(kind, BETTER_AUTH_PASSWORD_SIGN_IN_PATH, { email, password });
  expect(signin.status).toBe(200);
  const bearer = z.object({ token: z.string().min(1) }).parse(await signin.json()).token;
  const cookie = signin.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ');
  expect(cookie).toContain('session_token=');
  return { id, bearer, cookie };
};

const listPath = '/api/sign-in-clients';
const rotatePath = (id: string) => `${listPath}/${id}/rotate-secret`;
const disablePath = (id: string) => `${listPath}/${id}/disable`;
const versionInput = { expectedCredentialVersion: 1 };
const operations = () => [
  ['GET', listPath, undefined], ['POST', listPath, browserInput],
  ['POST', rotatePath(pending.client.id), versionInput], ['POST', disablePath(pending.client.id), undefined],
] as const;

const readRegistry = async () => ({
  clients: await database.db.query.signInClients.findMany(),
  events: await database.db.query.signInClientEvents.findMany(),
  reservations: await database.db.query.signInClientHostReservations.findMany(),
});

const scopedKeys: readonly TenantApiKeyScope[] = [
  'enrollment', 'marketing', 'transactional', 'subscriptions:read', 'subscriptions:adopt',
  'import:content', 'import:users', 'report:read',
];

beforeAll(async () => {
  database = await createTestDatabase('together_registry_routes', z.string().url().parse(process.env['DATABASE_URL']));
  deps = setup(allowed);
  app = buildApp(deps);
  await database.db.insert(organizations).values({
    id: 'org-registry', slug: 'registry', name: 'Organization', maxWorkspaces: 2, createdAt: now, updatedAt: now,
  });
  await database.db.insert(tenants).values([
    { id: 'acme', slug: 'acme', name: 'Workspace', organizationId: 'org-registry', createdAt: now },
    { id: 'studio', slug: 'studio', name: 'Other workspace', createdAt: now },
  ]);
  for (const kind of accountKinds) sessions.set(kind, await createSession(kind));
  await database.db.insert(tenantAdmins).values([
    { id: 'owner-grant', tenantId: 'acme', userId: session('owner').id, role: 'owner' },
    { id: 'admin-grant', tenantId: 'acme', userId: session('admin').id, role: 'admin' },
    { id: 'foreign-grant', tenantId: 'studio', userId: session('foreign').id, role: 'owner' },
    { id: 'unverified-grant', tenantId: 'acme', userId: session('unverified').id, role: 'owner' },
  ]);
  await database.db.insert(organizationMembers).values({
    id: 'derived-grant', organizationId: 'org-registry', userId: session('derived').id, role: 'owner',
    createdAt: now, createdByUserId: session('owner').id,
  });
  await database.db.insert(members).values({
    id: 'registry-member', tenantId: 'acme', userId: session('member').id, email: 'registry-member@example.test', createdAt: now,
  });

  const created = await request(app, 'POST', listPath, owner(), input);
  expect(created.status).toBe(201);
  expect(created.headers.get('cache-control')).toBe('no-store');
  pending = await data(created, signInClientCredentialSchema);
  expect(pending.client).toMatchObject({ state: 'pending_activation', credentialVersion: 1, redirectUris: input.redirectUris });

  const origin = workspaceOrigin;
  const cookie = session('owner').cookie;
  const started = await request(app, 'POST', API_ROUTES.impersonationStart.path, { cookie, origin }, { memberId: 'registry-member' });
  expect(started.status).toBe(200);
  const viewCookie = started.headers.getSetCookie().find((line) => line.includes('impersonation'))?.split(';')[0];
  impersonation = `${cookie}; ${z.string().min(1).parse(viewCookie)}`;
  const me = await request(app, 'GET', '/api/me', { cookie: impersonation });
  expect(await me.json()).toMatchObject({ data: { impersonation: { subjectMemberId: 'registry-member' } } });

  for (const scope of [undefined, ...scopedKeys]) {
    const response = await request(app, 'POST', API_ROUTES.apiKeysCreate.path, owner(), {
      name: scope ?? 'legacy key', ...(scope === undefined ? {} : { scopes: [scope], expiresAt: '2026-12-02T12:00:00.000Z' }),
    });
    expect(response.status, scope).toBe(200);
    machineCredentials.set(scope ?? 'legacy key', { [API_KEY_HEADER]: (await data(response, apiKeyCreateOutputSchema)).secret });
  }
  for (const mode of ['direct', 'propose']) {
    const response = await request(app, 'POST', API_ROUTES.apiKeysShopManagementCreate.path, owner(), {
      name: `${mode} shop key`, mode, scopes: ['shop:catalog:read'], expiresAt: '2026-12-02T12:00:00.000Z',
    });
    expect(response.status).toBe(200);
    machineCredentials.set(`${mode} shop key`, { [API_KEY_HEADER]: (await data(response, apiKeysShopManagementCreateOutputSchema)).secret });
  }
  machineCredentials.set('operator secret', { [SCHEDULER_OPERATOR_SECRET_HEADER]: operatorSecret });
}, 120_000);

afterAll(async () => { await database?.close(); });

describe('Dormant sign-in client HTTP management', () => {
  it.each(['admin', 'member', 'foreign', 'derived', 'unverified'] as const)('refuses all four operations to the %s session', async (kind) => {
    const before = await readRegistry();
    for (const [method, path, body] of operations()) {
      const response = await request(app, method, path, { authorization: `Bearer ${session(kind).bearer}` }, body);
      expect(response.status, `${method} ${path}`).toBe(403);
    }
    expect(await readRegistry()).toEqual(before);
  });

  it('refuses all four operations to an active impersonated browser session', async () => {
    const before = await readRegistry();
    for (const [method, path, body] of operations()) {
      const response = await request(app, method, path, { cookie: impersonation, origin: workspaceOrigin }, body);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'impersonation_read_only' } });
    }
    expect(await readRegistry()).toEqual(before);
  });

  it('refuses every machine credential on all four operations, including as a bearer', async () => {
    const before = await readRegistry();
    for (const [kind, headers] of machineCredentials) {
      const secret = z.string().parse(Object.values(headers)[0]);
      for (const [method, path, body] of operations()) {
        for (const credential of [headers, { authorization: `Bearer ${secret}` }]) {
          const response = await request(app, method, path, credential, body);
          expect(response.status, `${kind}: ${method} ${path}`).toBe(401);
          expect(await response.text()).not.toContain(secret);
        }
      }
    }
    expect(await readRegistry()).toEqual(before);
  });

  it('classifies only the exact three mutations in the session origin inventory and refuses foreign origins', async () => {
    const before = await readRegistry();
    const registered = app.routes.filter(({ path, method }) => path.startsWith(listPath) && method !== 'ALL');
    expect(registered.map(({ method, path }) => `${method} ${path}`).sort()).toEqual([
      'GET /api/sign-in-clients', 'POST /api/sign-in-clients', 'POST /api/sign-in-clients/:id/disable',
      'POST /api/sign-in-clients/:id/rotate-secret',
    ]);
    expect(registered.every((route) => publicRouteManifestEntry(route) === undefined)).toBe(true);
    for (const [method, path, body] of operations().slice(1)) {
      expect(requestOriginPolicy(method, path)).toBe('session');
      for (const metadata of [{ origin: 'https://untrusted.example.test' }, {}, { authorization: 'Bearer invalid.signature' }]) {
        const response = await request(app, method, path, { cookie: session('owner').cookie, ...metadata }, body);
        expect(response.status, `${method} ${path}`).toBe(403);
        expect(await response.json()).toMatchObject({ error: { message: 'Request origin is not allowed' } });
      }
    }
    expect(await readRegistry()).toEqual(before);
  });

  it('rejects malformed and extra fields without echoing request material', async () => {
    const marker = 'confidential-field-example';
    const responseChecks = [
      ['GET', `${listPath}?limit=1&limit=2&field=${marker}`, undefined],
      ['GET', `${listPath}?limit=101`, undefined],
      ['POST', listPath, { ...input, [marker]: marker }],
      ['POST', rotatePath(pending.client.id), { expectedCredentialVersion: '1', [marker]: marker }],
      ['POST', disablePath(pending.client.id), { [marker]: marker }],
      ['POST', disablePath(marker), undefined],
    ] as const;
    for (const [method, path, body] of responseChecks) {
      const response = await request(app, method, path, owner(), body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: { code: 'validation', message: 'Invalid sign-in client request' } });
    }
  });

  it.each([
    ['', 'registry_disabled'],
    ['studio=callback.example.test', 'host_not_preapproved'],
    ['acme=other.example.test', 'host_not_preapproved'],
  ])('gates creation and rotation on the exact configured pairs (%s)', async (hosts, reason) => {
    const restricted = buildApp(setup(hosts));
    const before = await readRegistry();
    for (const [path, body] of [[listPath, input], [rotatePath(pending.client.id), versionInput]] as const) {
      const response = await request(restricted, 'POST', path, owner(), body);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'forbidden', details: { reason } } });
    }
    const listed = await request(restricted, 'GET', listPath, owner());
    expect(listed.status).toBe(200);
    expect((await data(listed, signInClientPageSchema)).clients).toContainEqual(pending.client);
    expect(await readRegistry()).toEqual(before);
  });

  it('allows a same-origin browser to issue and rotate once, keeping raw secrets out of reads and refusals', async () => {
    const headers = { cookie: session('owner').cookie, origin: workspaceOrigin, 'sec-fetch-site': 'same-origin' };
    const created = await request(app, 'POST', listPath, headers, browserInput);
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const { client, secret } = await data(created, signInClientCredentialSchema);
    const rotated = await request(app, 'POST', rotatePath(client.id), headers, versionInput);
    expect(rotated.status).toBe(200);
    expect(rotated.headers.get('cache-control')).toBe('no-store');
    const replacement = await data(rotated, signInClientCredentialSchema);
    expect(replacement.secret).not.toBe(secret);
    expect(replacement.client.credentialVersion).toBe(2);
    const refused = await request(app, 'POST', rotatePath(client.id), headers, versionInput);
    expect(refused.status).toBe(409);
    const errorText = await refused.text();
    expect(errorText).toContain('credential_version_changed');
    const list = await request(app, 'GET', `${listPath}?limit=1`, owner());
    const raw = await list.text();
    const page = z.object({ data: signInClientPageSchema }).parse(JSON.parse(raw)).data;
    expect(page.clients).toHaveLength(1);
    expect(page.nextCursor).toBe(page.clients[0]?.id);
    const next = await request(app, 'GET', `${listPath}?limit=1&cursor=${page.nextCursor ?? ''}`, owner());
    expect((await data(next, signInClientPageSchema)).clients[0]?.id).not.toBe(page.nextCursor);
    for (const plaintext of [secret, replacement.secret]) {
      expect(errorText).not.toContain(plaintext);
      expect(raw).not.toContain(plaintext);
      expect(JSON.stringify(await readRegistry())).not.toContain(plaintext);
    }
  });

  it('still permits terminal disable while empty and returns the same scrubbed record on repeat', async () => {
    const disabledApp = buildApp(setup());
    const headers = { cookie: session('owner').cookie, origin: workspaceOrigin };
    const disable = () => request(disabledApp, 'POST', disablePath(pending.client.id), headers);
    const response = await disable();
    expect(response.status).toBe(200);
    const retired = await data(response, signInClientDisableOutputSchema);
    expect(retired.client).toMatchObject({ state: 'retired', name: null, redirectUris: [], secretExpiresAt: null, credentialVersion: 2 });
    expect(await data(await disable(), signInClientDisableOutputSchema)).toEqual(retired);
    const reused = await request(app, 'POST', listPath, owner(), input);
    expect(reused.status).toBe(409);
    expect(await reused.json()).toMatchObject({ error: { details: { reason: 'host_unavailable' } } });
  });
});
