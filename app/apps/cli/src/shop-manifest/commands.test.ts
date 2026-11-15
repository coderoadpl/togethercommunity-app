import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '#core/client/index.js';
import { tenantSettingsSchema } from '#core/domain/index.js';
import type * as ConfigModule from '../config.js';
import { readManifestFile } from './commands.js';
import { createInstanceFetch, type FakeInstance } from './fake-instance.js';
import { manifestWorkspaceOrigins, workspaceHostGuard } from './instance.js';

const h = vi.hoisted(() => ({ apiUrl: 'https://togethercommunity.app' }));
vi.mock('../config.js', async (importOriginal) => ({
  ...await importOriginal<typeof ConfigModule>(),
  loadConfig: () => ({
    version: 2,
    currentOrigin: h.apiUrl,
    profiles: { [h.apiUrl]: { token: 'session-fixture', tenant: null } },
  }),
  saveConfig: vi.fn(),
}));

const originalArgv = process.argv;
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = 0;
  process.argv = originalArgv;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const inputFile = async (text: string) => {
  const directory = await mkdtemp(join(tmpdir(), 'shop-manifest-'));
  directories.push(directory);
  const path = join(directory, 'manifest.json');
  await writeFile(path, text);
  return path;
};
const runCli = async (args: string[], apiUrl = 'https://togethercommunity.app') => {
  h.apiUrl = apiUrl;
  process.argv = ['node', 'together', '--api-url', apiUrl, '--json', ...args];
  vi.resetModules();
  await import('../main.js');
};

const { createServer } = process.getBuiltinModule('node:http');
type TestRequest = { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: string };
type TestResponse = { status: number; headers: Record<string, string>; body: string };
const listen = async (handler: (request: TestRequest) => TestResponse) => {
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => { body += chunk; });
    request.on('end', () => {
      const answer = handler({ method: request.method ?? '', path: request.url ?? '/', headers: request.headers, body });
      response.writeHead(answer.status, answer.headers);
      response.end(answer.body);
    });
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP test server');
  return {
    port: address.port,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }),
  };
};
const jsonAnswer = (status: number, body: unknown): TestResponse => ({ status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('shop manifest command boundary', () => {
  const hostedInstances = (): FakeInstance[] => [
    { baseDomain: 'togethercommunity.app', workspaces: ['acme'], customDomains: { 'shop.acme.example.test': 'acme' } },
    { baseDomain: 'staging.togethercommunity.app', workspaces: ['acme'] },
    { baseDomain: 'preview.togethercommunity.app', workspaces: ['acme'] },
  ];
  const provisioningManifest = { version: 1, shops: [
    { workspace: 'acme', products: [] },
    { workspace: { slug: 'studio', provision: { name: 'Studio', ownerEmail: 'owner@togethercommunity.app' } }, products: [] },
  ] };

  it.each(['plan', 'apply', 'drift'])('%s refuses an origin outside the reported instance after asking only that origin', async (command) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fake = createInstanceFetch(hostedInstances());
    vi.spyOn(globalThis, 'fetch').mockImplementation(fake.fetchImpl);
    const path = await inputFile(JSON.stringify({ version: 1, shops: [{ workspace: 'acme', products: [] }] }));
    await runCli(['shop', command, '--manifest', path], 'https://shop.acme.example.test');
    expect(fake.requests.map((request) => `${request.origin} ${request.path}`))
      .toEqual(['https://shop.acme.example.test /api/tenants', 'https://shop.acme.example.test /api/me', 'https://shop.acme.example.test /api/tenant/routing']);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });

  it.each([
    ['https://acme.staging.togethercommunity.app', 'staging.togethercommunity.app'],
    ['https://togethercommunity.app', 'togethercommunity.app'],
    ['https://preview.togethercommunity.app', 'preview.togethercommunity.app'],
  ])('keeps the session, workspace reads and operator provisioning of %s on its own instance', async (apiUrl, baseDomain) => {
    vi.stubEnv('TOGETHER_SHOP_OPERATOR_SECRET', 'operator-fixture');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fake = createInstanceFetch(hostedInstances());
    vi.spyOn(globalThis, 'fetch').mockImplementation(fake.fetchImpl);
    await runCli(['shop', 'apply', '--manifest', await inputFile(JSON.stringify(provisioningManifest))], apiUrl);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: true, data: { applied: [{ workspace: 'studio', operation: 'workspace:provision' }] } });
    expect(fake.requests.filter((request) => request.path === '/api/internal/tenants/provision')).toMatchObject([
      { origin: apiUrl, authorization: null, secret: 'operator-fixture' },
    ]);
    expect(new Set(fake.requests.filter((request) => request.authorization !== null).map((request) => request.origin)))
      .toEqual(new Set([apiUrl, `https://acme.${baseDomain}`, `https://studio.${baseDomain}`]));
    expect(fake.requests.every((request) => new URL(request.origin).hostname.endsWith(baseDomain))).toBe(true);
  });

  describe('workspaces the API origin has not confirmed', () => {
    const separateInstances = (): FakeInstance[] => [
      { baseDomain: 'togethercommunity.app', workspaces: ['acme'] },
      { baseDomain: 'preview.togethercommunity.app', workspaces: ['preview'] },
    ];
    const manifest = { version: 1, shops: [{ workspace: 'acme', products: [] }, { workspace: 'preview', products: [] }] };
    const separateHostRequests = (requests: ReturnType<typeof createInstanceFetch>['requests']) =>
      requests.filter((request) => request.origin === 'https://preview.togethercommunity.app');

    it.each([['plan', 0], ['drift', 1]] as const)('%s reports a slug that names another instance host as missing without a request to it', async (command, exitCode) => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const fake = createInstanceFetch(separateInstances());
      vi.spyOn(globalThis, 'fetch').mockImplementation(fake.fetchImpl);
      await runCli(['shop', command, '--manifest', await inputFile(JSON.stringify(manifest))], 'https://acme.togethercommunity.app');
      expect(separateHostRequests(fake.requests)).toEqual([]);
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: true, data: { shops: [
        { workspace: 'acme', provisioning: 'unchanged' }, { workspace: 'preview', provisioning: 'missing' },
      ] } });
      expect(process.exitCode).toBe(exitCode);
    });

    it('apply stops before any write or request to the unconfirmed workspace', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const fake = createInstanceFetch(separateInstances());
      vi.spyOn(globalThis, 'fetch').mockImplementation(fake.fetchImpl);
      const input = { ...manifest, company: { settings: { invoiceSellerName: 'Acme' } } };
      await runCli(['shop', 'apply', '--manifest', await inputFile(JSON.stringify(input))], 'https://acme.togethercommunity.app');
      expect(separateHostRequests(fake.requests)).toEqual([]);
      expect(fake.requests.every((request) => request.method === 'GET')).toBe(true);
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: false, error: { code: 'validation', details: { failure: { workspaces: ['preview'] }, applied: [] } } });
      expect(process.exitCode).toBe(2);
    });

    it('plans an unconfirmed provisioning entry as a creation without a request to its host', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const fake = createInstanceFetch(separateInstances());
      vi.spyOn(globalThis, 'fetch').mockImplementation(fake.fetchImpl);
      const input = { version: 1, shops: [{ workspace: 'acme', products: [] }, { workspace: { slug: 'preview', provision: { name: 'Preview', ownerEmail: 'owner@togethercommunity.app' } }, products: [] }] };
      await runCli(['shop', 'plan', '--manifest', await inputFile(JSON.stringify(input))], 'https://acme.togethercommunity.app');
      expect(separateHostRequests(fake.requests)).toEqual([]);
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: true, data: { shops: [{ provisioning: 'unchanged' }, { workspace: 'preview', provisioning: 'create' }] } });
    });
  });

  describe('derived workspace hosts that another instance serves', () => {
    const tokenRequestsTo = (requests: ReturnType<typeof createInstanceFetch>['requests'], origin: string) =>
      requests.filter((request) => request.origin === origin && (request.authorization !== null || request.secret !== null));

    it('sends no token to the host of a workspace this run provisioned when another instance serves that host', async () => {
      vi.stubEnv('TOGETHER_SHOP_OPERATOR_SECRET', 'operator-fixture');
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const fake = createInstanceFetch([
        { baseDomain: 'togethercommunity.app', workspaces: ['acme'] },
        { baseDomain: 'preview.togethercommunity.app', workspaces: ['preview'] },
      ]);
      vi.spyOn(globalThis, 'fetch').mockImplementation(fake.fetchImpl);
      const input = { version: 1, shops: [{ workspace: 'acme', products: [] }, { workspace: { slug: 'preview', provision: { name: 'Preview', ownerEmail: 'owner@togethercommunity.app' } }, products: [] }] };
      await runCli(['shop', 'apply', '--manifest', await inputFile(JSON.stringify(input))], 'https://acme.togethercommunity.app');
      expect(tokenRequestsTo(fake.requests, 'https://preview.togethercommunity.app')).toEqual([]);
      expect(fake.requests.filter((request) => request.origin === 'https://preview.togethercommunity.app').map((request) => request.path)).toEqual(['/api/health']);
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: false, error: {
        code: 'validation', message: expect.stringContaining('does not serve'),
        details: { failure: { workspace: 'preview' }, applied: [{ workspace: 'preview', operation: 'workspace:provision' }] },
      } });
      expect(process.exitCode).toBe(2);
    });

    it.each(['plan', 'drift'])('%s sends no token to the host of a listed workspace when another instance serves that host', async (command) => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const fake = createInstanceFetch([
        { baseDomain: 'togethercommunity.app', workspaces: ['acme', 'preview'] },
        { baseDomain: 'preview.togethercommunity.app', workspaces: ['preview'] },
      ]);
      vi.spyOn(globalThis, 'fetch').mockImplementation(fake.fetchImpl);
      const input = { version: 1, shops: [{ workspace: 'acme', products: [] }, { workspace: 'preview', products: [] }] };
      await runCli(['shop', command, '--manifest', await inputFile(JSON.stringify(input))], 'https://acme.togethercommunity.app');
      expect(tokenRequestsTo(fake.requests, 'https://preview.togethercommunity.app')).toEqual([]);
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: false, error: { code: 'validation', details: { workspace: 'preview' } } });
      expect(process.exitCode).toBe(2);
    });
  });

  it('never sends the token of a bare environment host to production workspace hosts', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fake = createInstanceFetch(hostedInstances());
    vi.spyOn(globalThis, 'fetch').mockImplementation(fake.fetchImpl);
    await runCli(['shop', 'plan', '--manifest', await inputFile(JSON.stringify({ version: 1, shops: [{ workspace: 'acme', products: [] }] }))], 'https://preview.togethercommunity.app');
    expect(fake.requests.length).toBeGreaterThan(0);
    expect(fake.requests.filter((request) => !new URL(request.origin).hostname.endsWith('preview.togethercommunity.app'))).toEqual([]);
  });

  it('requires an explicit base domain on the platform host and then stays on that instance', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fake = createInstanceFetch(hostedInstances());
    vi.spyOn(globalThis, 'fetch').mockImplementation(fake.fetchImpl);
    const path = await inputFile(JSON.stringify({ version: 1, shops: [{ workspace: 'acme', products: [] }] }));
    await runCli(['shop', 'plan', '--manifest', path], 'https://start.staging.togethercommunity.app');
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('--base-domain') } });
    await runCli(['shop', 'plan', '--manifest', path, '--base-domain', 'togethercommunity.app'], 'https://start.staging.togethercommunity.app');
    expect(JSON.parse(String(log.mock.calls[1]?.[0]))).toMatchObject({ ok: false, error: { code: 'validation' } });
    await runCli(['shop', 'plan', '--manifest', path, '--base-domain', 'staging.togethercommunity.app'], 'https://start.staging.togethercommunity.app');
    expect(JSON.parse(String(log.mock.calls[2]?.[0]))).toMatchObject({ ok: true, data: { shops: [{ workspace: 'acme' }] } });
    expect(fake.requests.every((request) => new URL(request.origin).hostname.endsWith('.staging.togethercommunity.app'))).toBe(true);
  });

  it.each([
    ['plan', 'staging'],
    ['apply', 'status'],
    ['drift', 'docs'],
    ['plan', { slug: 'staging', provision: { name: 'Staging', ownerEmail: 'owner@togethercommunity.app' } }],
    ['apply', { slug: 'WWW', provision: { name: 'Web', ownerEmail: 'owner@togethercommunity.app' } }],
  ])('%s refuses the reserved workspace %j before any request', async (command, workspace) => {
    vi.stubEnv('TOGETHER_SHOP_OPERATOR_SECRET', 'operator-fixture');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetch = vi.spyOn(globalThis, 'fetch');
    const path = await inputFile(JSON.stringify({ version: 1, shops: [{ workspace: 'acme', products: [] }, { workspace, products: [] }] }));
    await runCli(['shop', command, '--manifest', path, '--shop', 'acme'], 'https://acme.togethercommunity.app');
    expect(fetch).not.toHaveBeenCalled();
    const output: unknown = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(output).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(JSON.stringify(output)).toContain('"path":["shops",1,"workspace"]');
    expect(process.exitCode).toBe(2);
  });

  it.each([
    ['a workspace read', '/api/me', ['plan'], { workspace: 'acme', products: [] }],
    ['an integration configure request', '/api/integrations/stripe/configure', ['apply', '--integrations'],
      { workspace: 'acme', integrations: { stripe: { restrictedKeyEnv: 'SHOP_STRIPE_KEY', mode: 'test' } }, products: [] }],
    ['a provisioning request', '/api/internal/tenants/provision', ['apply'],
      { workspace: { slug: 'studio', provision: { name: 'Studio', ownerEmail: 'owner@togethercommunity.app' } }, products: [] }],
  ])('refuses a redirect of %s without resending credentials to the target', async (_case, redirectPath, args, shop) => {
    vi.stubEnv('SHOP_STRIPE_KEY', 'rk_test_private-fixture');
    vi.stubEnv('TOGETHER_SHOP_OPERATOR_SECRET', 'operator-fixture');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const received: string[] = [];
    const target = await listen((request) => {
      received.push(`${request.method} ${request.path} ${String(request.headers.authorization)} ${request.body}`);
      return jsonAnswer(200, { ok: true, data: {} });
    });
    const source = await listen((request) => {
      const path = new URL(request.path, 'http://localhost').pathname;
      const slug = String(request.headers['x-tenant']);
      if (path === '/api/tenants') {
        const tenant = { id: 't1', slug: 'acme', name: 'acme', status: 'active', plan: 'hosted', contentVersion: 1 };
        return jsonAnswer(200, { ok: true, data: { tenants: [{ tenant, staffRole: 'owner' }], memberTenants: [], canCreateTenant: false } });
      }
      if (path === '/api/tenant-secrets') return jsonAnswer(200, { ok: true, data: { secrets: [], stripeMode: null, stripeWebhookUrl: 'https://acme.togethercommunity.app/api/webhooks/stripe/t1' } });
      if (path === redirectPath) return { status: 307, headers: { location: `http://127.0.0.1:${String(target.port)}${path}` }, body: '' };
      if (path === '/api/me' && slug === 'studio') return jsonAnswer(404, { ok: false, error: { code: 'tenant_not_found', message: 'No tenant' } });
      const data = path === '/api/me' ? { userId: 'u1', email: 'owner@togethercommunity.app', name: 'Owner', emailVerified: true, tenant: { id: 't1', slug, name: slug, staffRole: 'owner', memberId: null, banned: false } }
        : path === '/api/tenant/settings' ? { settings: tenantSettingsSchema.parse({ name: slug, billingPortalUrl: null, bunnyStreamLibraryId: null }) } : { products: [] };
      return jsonAnswer(200, { ok: true, data });
    });
    try {
      const path = await inputFile(JSON.stringify({ version: 1, shops: [shop] }));
      await runCli(['shop', ...args, '--manifest', path], `http://localhost:${String(source.port)}`);
    } finally {
      await source.close();
      await target.close();
    }
    expect(received).toEqual([]);
    const output = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(output)).toMatchObject({ ok: false, error: { code: 'internal', message: expect.stringContaining('refused a redirect') } });
    expect(output).not.toContain('private-fixture');
    expect(process.exitCode).not.toBe(0);
  });

  it('does not print JSON parser input or file errors', async () => {
    const path = await inputFile('{"password":"never-echo-this",');
    expect(await readManifestFile(path)).toEqual({ ok: false, error: { code: 'validation', message: 'Manifest must be valid JSON' } });
    expect(await readManifestFile(join(path, 'missing'))).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it.each(['plan', 'apply', 'drift'])('%s emits one failure envelope and uses the validation exit code', async (command) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const path = await inputFile('not JSON');
    await runCli(['--json', 'shop', command, '--manifest', path]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });

  it('emits the drift diff in one successful envelope but exits 1 when a managed setting differs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fake = createInstanceFetch(hostedInstances());
    vi.spyOn(globalThis, 'fetch').mockImplementation(fake.fetchImpl);
    const path = await inputFile(JSON.stringify({ version: 1, company: { settings: { invoiceSellerName: 'Studio' } }, shops: [{ workspace: 'acme', products: [] }] }));
    await runCli(['shop', 'drift', '--manifest', path]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: true, data: { drifted: true, shops: [{ settings: { change: ['invoiceSellerName'] } }] } });
    expect(fake.requests.every((request) => request.method === 'GET')).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('passes the integrations opt-in and environment values only to the existing configure route', async () => {
    vi.stubEnv('SHOP_STRIPE_KEY', 'rk_test_private-fixture');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fake = createInstanceFetch(hostedInstances());
    vi.spyOn(globalThis, 'fetch').mockImplementation(fake.fetchImpl);
    const path = await inputFile(JSON.stringify({ version: 1, company: { integrations: { stripe: { restrictedKeyEnv: 'SHOP_STRIPE_KEY', mode: 'test' } } }, shops: [{ workspace: 'acme', products: [] }] }));
    await runCli(['shop', 'apply', '--manifest', path]);
    expect(fake.requests.every((request) => request.method === 'GET')).toBe(true);
    await runCli(['shop', 'apply', '--manifest', path, '--integrations']);
    const writes = fake.requests.filter((request) => request.method !== 'GET');
    expect(writes.map((request) => `${request.method} ${request.origin}${request.path}`)).toEqual(['POST https://acme.togethercommunity.app/api/integrations/stripe/configure']);
    expect(JSON.parse(String(writes[0]?.body))).toEqual({ mode: 'test', restrictedKey: 'rk_test_private-fixture' });
    expect(log).toHaveBeenCalledTimes(2);
    for (const call of log.mock.calls) expect(String(call[0])).not.toContain('rk_test_private-fixture');
  });

  it('repeats the payment configure request only with --reconfigure-payments once the workspace reports the mode as configured', async () => {
    vi.stubEnv('SHOP_STRIPE_KEY', 'rk_test_private-fixture');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fake = createInstanceFetch(hostedInstances());
    vi.spyOn(globalThis, 'fetch').mockImplementation(fake.fetchImpl);
    const path = await inputFile(JSON.stringify({ version: 1, company: { integrations: { stripe: { restrictedKeyEnv: 'SHOP_STRIPE_KEY', mode: 'test' } } }, shops: [{ workspace: 'acme', products: [] }] }));
    const configureRequests = () => fake.requests.filter((request) => request.path === '/api/integrations/stripe/configure').length;
    await runCli(['shop', 'apply', '--manifest', path, '--integrations']);
    expect(configureRequests()).toBe(1);
    await runCli(['shop', 'apply', '--manifest', path, '--integrations']);
    expect(configureRequests()).toBe(1);
    expect(JSON.parse(String(log.mock.calls[1]?.[0]))).toMatchObject({ ok: true, data: { applied: [], shops: [{ integrations: [{ provider: 'stripe', configured: true, action: 'unchanged' }] }] } });
    await runCli(['shop', 'apply', '--manifest', path, '--reconfigure-payments']);
    expect(JSON.parse(String(log.mock.calls[2]?.[0]))).toMatchObject({ ok: false, error: { code: 'validation' } });
    await runCli(['shop', 'apply', '--manifest', path, '--integrations', '--reconfigure-payments']);
    expect(configureRequests()).toBe(2);
    for (const call of log.mock.calls) expect(String(call[0])).not.toContain('rk_test_private-fixture');
  });

  it.each(['plan', 'apply', 'drift'])('%s sends the session and shop selector through the typed client without writes for an empty catalogue', async (command) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fake = createInstanceFetch(hostedInstances());
    vi.spyOn(globalThis, 'fetch').mockImplementation(fake.fetchImpl);
    const path = await inputFile(JSON.stringify({ version: 1, shops: [{ workspace: 'acme', products: [] }] }));
    await runCli(['--json', 'shop', command, '--manifest', path, '--shop', 'acme']);
    expect(fake.requests.map((request) => `${request.method} ${request.origin}${request.path}`)).toEqual([
      'GET https://togethercommunity.app/api/tenants',
      'GET https://togethercommunity.app/api/me', 'GET https://togethercommunity.app/api/tenant/routing',
      'GET https://togethercommunity.app/api/health', 'GET https://acme.togethercommunity.app/api/health',
      'GET https://acme.togethercommunity.app/api/me', 'GET https://acme.togethercommunity.app/api/tenant/settings', 'GET https://acme.togethercommunity.app/api/products',
    ]);
    const [health, authenticated] = [fake.requests.filter((request) => request.path === '/api/health'), fake.requests.filter((request) => request.path !== '/api/health')];
    expect(health.map((request) => [request.authorization, request.tenant])).toEqual([[null, null], [null, null]]);
    expect(authenticated.every((request) => request.authorization === 'Bearer session-fixture')).toBe(true);
    expect(authenticated.map((request) => request.tenant)).toEqual([null, 'acme', 'acme', 'acme', 'acme', 'acme']);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: true, data: { shops: [{ workspace: 'acme', products: [] }] } });
    expect(String(log.mock.calls[0]?.[0])).not.toContain('session-fixture');
  });
});

const instances = (): FakeInstance[] => [
  { baseDomain: 'togethercommunity.app', workspaces: ['acme', 'studio'], customDomains: { 'shop.acme.example.test': 'acme' } },
  { baseDomain: 'staging.togethercommunity.app', workspaces: ['acme', 'studio'] },
  { baseDomain: 'preview.togethercommunity.app', workspaces: ['acme', 'studio'] },
  { baseDomain: 'localhost', port: '48730', workspaces: ['acme', 'studio'] },
];

const discover = async (apiUrl: string, setup: FakeInstance[] = instances(), workspaces = ['acme', 'studio'], baseDomain?: string, signedIn = true) => {
  const fake = createInstanceFetch(setup);
  const probeFor = (workspace: string) => createApiClient({
    baseUrl: apiUrl, fetchImpl: fake.fetchImpl, refuseRedirects: true,
    headers: () => ({ ...(signedIn ? { authorization: 'Bearer session-fixture' } : {}), 'x-tenant': workspace }),
  });
  return { result: await manifestWorkspaceOrigins(apiUrl, probeFor, workspaces, baseDomain), requests: fake.requests };
};

describe('workspace host guard', () => {
  const guardOn = (setup: FakeInstance[], profileOrigin = 'https://acme.togethercommunity.app') => {
    const fake = createInstanceFetch(setup);
    const guard = workspaceHostGuard(profileOrigin, (origin) => createApiClient({ baseUrl: origin, fetchImpl: fake.fetchImpl, refuseRedirects: true }));
    return { guard, requests: fake.requests };
  };

  it('accepts a host that the same instance serves after asking both hosts without credentials once', async () => {
    const { guard, requests } = guardOn(instances());
    expect(await guard('https://studio.togethercommunity.app')).toEqual({ ok: true, value: true });
    expect(await guard('https://studio.togethercommunity.app')).toEqual({ ok: true, value: true });
    expect(requests.map((request) => `${request.origin}${request.path} ${String(request.authorization)}`)).toEqual([
      'https://acme.togethercommunity.app/api/health null', 'https://studio.togethercommunity.app/api/health null',
    ]);
  });

  it('accepts the profile origin itself without a request', async () => {
    const { guard, requests } = guardOn(instances());
    expect((await guard('https://acme.togethercommunity.app')).ok).toBe(true);
    expect(requests).toEqual([]);
  });

  it.each([
    ['another instance', 'https://acme.preview.togethercommunity.app', instances()],
    ['a host that does not answer', 'https://studio.example.test', instances()],
    ['an instance that reports no database fingerprint', 'https://studio.togethercommunity.app',
      [{ baseDomain: 'togethercommunity.app', workspaces: ['acme', 'studio'], databaseFingerprint: null }]],
  ])('refuses a host of %s', async (_case, origin, setup) => {
    const { guard } = guardOn(setup);
    expect(await guard(origin)).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('not served by the instance') } });
  });

  it('refuses a host of the same base domain that reports another database', async () => {
    const profile = createInstanceFetch([{ baseDomain: 'togethercommunity.app', workspaces: ['acme'] }]);
    const other = createInstanceFetch([{ baseDomain: 'togethercommunity.app', workspaces: ['studio'], databaseFingerprint: 'abcdefabcdef' }]);
    const guard = workspaceHostGuard('https://acme.togethercommunity.app', (origin) => createApiClient({
      baseUrl: origin, refuseRedirects: true, fetchImpl: origin === 'https://acme.togethercommunity.app' ? profile.fetchImpl : other.fetchImpl,
    }));
    expect((await guard('https://studio.togethercommunity.app')).ok).toBe(false);
  });
});

describe('manifest instance discovery', () => {
  it.each([
    ['https://togethercommunity.app', 'https://studio.togethercommunity.app'],
    ['https://acme.togethercommunity.app', 'https://studio.togethercommunity.app'],
    ['https://acme.staging.togethercommunity.app', 'https://studio.staging.togethercommunity.app'],
    ['https://acme.staging.togethercommunity.app.', 'https://studio.staging.togethercommunity.app'],
    ['https://staging.togethercommunity.app', 'https://studio.staging.togethercommunity.app'],
    ['https://preview.togethercommunity.app', 'https://studio.preview.togethercommunity.app'],
    ['http://acme.localhost:48730', 'http://studio.localhost:48730'],
  ])('maps %s to the workspace host that its own instance reports', async (apiUrl, expected) => {
    const { result, requests } = await discover(apiUrl);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value('studio')).toBe(expected);
    expect(new Set(requests.map((request) => request.origin))).toEqual(new Set([new URL(apiUrl).origin]));
    expect(requests.map((request) => request.path)).toEqual(['/api/me', '/api/tenant/routing']);
  });

  it('never maps the bare host of another instance onto production workspace hosts', async () => {
    const { result } = await discover('https://preview.togethercommunity.app');
    if (!result.ok) throw new Error(result.error.message);
    for (const workspace of ['acme', 'studio']) expect(new URL(result.value(workspace)).hostname).toBe(`${workspace}.preview.togethercommunity.app`);
  });

  it('keeps a plain localhost origin and selects workspaces by header without discovery requests', async () => {
    const { result, requests } = await discover('http://localhost:9876');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value('studio')).toBe('http://localhost:9876');
    expect(requests).toEqual([]);
  });

  it('skips workspaces that do not exist yet and probes the next selected one', async () => {
    const { result, requests } = await discover('https://togethercommunity.app', instances(), ['newshop', 'studio']);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value('newshop')).toBe('https://newshop.togethercommunity.app');
    expect(requests.map((request) => `${request.tenant} ${request.path}`)).toEqual(['newshop /api/me', 'studio /api/me', 'studio /api/tenant/routing']);
  });

  it.each([
    ['a custom workspace domain', 'https://shop.acme.example.test', instances()],
    ['routing that points to another domain', 'https://acme.togethercommunity.app', [{ baseDomain: 'togethercommunity.app', workspaces: ['acme'], tenantHost: 'acme.example.test' }]],
    ['routing for another workspace than the resolved one', 'https://acme.togethercommunity.app', [{ baseDomain: 'togethercommunity.app', workspaces: ['acme'], tenantHost: 'other.togethercommunity.app' }]],
    ['routing on another port', 'https://acme.togethercommunity.app', [{ baseDomain: 'togethercommunity.app', workspaces: ['acme'], tenantHost: 'acme.togethercommunity.app:8443' }]],
    ['an origin two labels below the reported base domain', 'https://acme.staging.togethercommunity.app', [{ baseDomain: 'togethercommunity.app', workspaces: ['acme'], customDomains: { 'acme.staging.togethercommunity.app': 'acme' } }]],
  ])('refuses %s', async (_case, apiUrl, setup) => {
    const { result } = await discover(apiUrl, setup);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('Cannot use this API origin') } });
  });

  it('refuses an unparseable origin without a request', async () => {
    const { result, requests } = await discover('not a url');
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(requests).toEqual([]);
  });

  it('stops on an authentication failure of the origin instead of guessing or using the explicit value', async () => {
    const { result, requests } = await discover('https://start.togethercommunity.app', instances(), ['acme', 'studio'], 'togethercommunity.app', false);
    expect(result).toMatchObject({ ok: false, error: { code: 'unauthorized', details: { operation: 'instance:identity' } } });
    expect(requests).toHaveLength(1);
  });

  describe('explicit base domain', () => {
    it('requires it on the platform host, which reports no workspace', async () => {
      expect((await discover('https://start.togethercommunity.app')).result)
        .toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('--base-domain') } });
      const { result } = await discover('https://start.togethercommunity.app', instances(), ['acme'], 'togethercommunity.app');
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value('studio')).toBe('https://studio.togethercommunity.app');
    });

    it.each([
      ['the platform host of another instance', 'https://start.staging.togethercommunity.app', 'togethercommunity.app'],
      ['a bare host of another instance', 'https://preview.togethercommunity.app', 'togethercommunity.app'],
    ])('refuses %s', async (_case, apiUrl, baseDomain) => {
      const setup = instances().map((instance) => ({ ...instance, workspaces: [] }));
      const { result } = await discover(apiUrl, setup, ['studio'], baseDomain);
      expect(result).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('platform host') } });
    });

    it('accepts the bare host of an instance whose selected workspaces are all new', async () => {
      const setup = instances().map((instance) => ({ ...instance, workspaces: [] }));
      const { result } = await discover('https://preview.togethercommunity.app', setup, ['studio'], 'preview.togethercommunity.app');
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value('studio')).toBe('https://studio.preview.togethercommunity.app');
    });

    it('refuses an explicit value that contradicts the reported base domain', async () => {
      const { result } = await discover('https://preview.togethercommunity.app', instances(), ['acme'], 'togethercommunity.app');
      expect(result).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('does not match') } });
    });
  });
});
