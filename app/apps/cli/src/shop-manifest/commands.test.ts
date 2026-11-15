import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok, tenantSettingsSchema } from '#core/domain/index.js';
import { manifestWorkspaceOrigins, readManifestFile, registerShopManifestCommands } from './commands.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const inputFile = async (text: string) => {
  const directory = await mkdtemp(join(tmpdir(), 'shop-manifest-'));
  directories.push(directory);
  const path = join(directory, 'manifest.json');
  await writeFile(path, text);
  return path;
};
const program = () => {
  const cli = new Command().option('--json');
  registerShopManifestCommands(cli, () => ok({ apiUrl: 'https://togethercommunity.app', profile: { token: 'session-fixture' }, json: true }));
  return cli;
};

describe('shop manifest command boundary', () => {
  it.each([
    ['https://togethercommunity.app', 'https://studio.togethercommunity.app'],
    ['https://acme.togethercommunity.app', 'https://studio.togethercommunity.app'],
    ['https://start.togethercommunity.app', 'https://studio.togethercommunity.app'],
    ['https://acme.staging.togethercommunity.app', 'https://studio.staging.togethercommunity.app'],
    ['https://start.staging.togethercommunity.app', 'https://studio.staging.togethercommunity.app'],
    ['https://acme.staging.togethercommunity.app.', 'https://studio.staging.togethercommunity.app'],
    ['http://localhost:9876', 'http://localhost:9876'],
    ['http://acme.localhost:48730', 'http://studio.localhost:48730'],
    ['http://start.localhost:48730', 'http://studio.localhost:48730'],
  ])('routes %s to the selected workspace on the same instance', (url, expected) => {
    const origins = manifestWorkspaceOrigins(url);
    if (!origins.ok) throw new Error('Expected a derivable origin');
    expect(origins.value('studio')).toBe(expected);
  });

  it.each([
    'https://custom.example.test',
    'https://shop.acme.example.test',
    'https://staging.togethercommunity.app',
    'https://www.togethercommunity.app',
    'https://togethercommunity.app.example.test',
    'https://eviltogethercommunity.app',
    'http://127.0.0.1:48730',
    'not a url',
  ])('refuses %s because workspace hosts cannot be derived from it', (url) => {
    expect(manifestWorkspaceOrigins(url)).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('Cannot derive workspace hosts') } });
  });

  it.each(['plan', 'apply', 'drift'])('%s refuses an underivable origin before any request', async (command) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetch = vi.spyOn(globalThis, 'fetch');
    const cli = new Command().option('--json');
    registerShopManifestCommands(cli, () => ok({ apiUrl: 'https://shop.acme.example.test', profile: { token: 'session-fixture' }, json: true }));
    const path = await inputFile(JSON.stringify({ version: 1, shops: [{ workspace: 'acme', products: [] }] }));
    await cli.parseAsync(['--json', 'shop', command, '--manifest', path], { from: 'user' });
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });

  it('keeps the session, workspace reads and operator provisioning on the staging instance of the profile', async () => {
    vi.stubEnv('TOGETHER_SHOP_OPERATOR_SECRET', 'operator-fixture');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const requests: Array<{ host: string; path: string; authorization: string | null }> = [];
    let provisioned = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      requests.push({ host: url.host, path: url.pathname, authorization: headers.get('authorization') });
      const slug = url.hostname.split('.')[0] ?? '';
      if (url.pathname === '/api/internal/tenants/provision') {
        provisioned = true;
        return Response.json({ ok: true, data: {
          tenant: { id: 't2', slug: 'studio', name: 'Studio' }, created: true, ownerUserId: 'u1',
          readiness: { tenantExists: true, ownerGrantPresent: true, storageConfigured: false, lastProbeOk: false,
            lastProbeAt: null, stripeConfigured: false, mode: null, webhookEndpointRegistered: false, legalUrlsSet: false, publishedProducts: 0 },
        } });
      }
      if (url.pathname === '/api/me' && slug === 'studio' && !provisioned) {
        return Response.json({ ok: false, error: { code: 'tenant_not_found', message: 'No tenant' } }, { status: 404 });
      }
      const data = url.pathname === '/api/me' ? { userId: 'u1', email: 'owner@togethercommunity.app', name: 'Owner', emailVerified: true, tenant: { id: 't1', slug, name: slug, staffRole: 'owner', memberId: null, banned: false } }
        : url.pathname === '/api/tenant/settings' ? { settings: tenantSettingsSchema.parse({ name: slug, billingPortalUrl: null, bunnyStreamLibraryId: null }) } : { products: [] };
      return Response.json({ ok: true, data });
    });
    const cli = new Command().option('--json');
    registerShopManifestCommands(cli, () => ok({ apiUrl: 'https://acme.staging.togethercommunity.app', profile: { token: 'session-fixture' }, json: true }));
    const path = await inputFile(JSON.stringify({ version: 1, shops: [
      { workspace: 'acme', products: [] },
      { workspace: { slug: 'studio', provision: { name: 'Studio', ownerEmail: 'owner@togethercommunity.app' } }, products: [] },
    ] }));
    await cli.parseAsync(['--json', 'shop', 'apply', '--manifest', path], { from: 'user' });
    expect(provisioned).toBe(true);
    expect(requests.find((request) => request.path === '/api/internal/tenants/provision')).toEqual({
      host: 'acme.staging.togethercommunity.app', path: '/api/internal/tenants/provision', authorization: null,
    });
    expect(new Set(requests.filter((request) => request.authorization !== null).map((request) => request.host)))
      .toEqual(new Set(['acme.staging.togethercommunity.app', 'studio.staging.togethercommunity.app']));
    expect(requests.every((request) => request.host.endsWith('.staging.togethercommunity.app'))).toBe(true);
  });

  it('does not print JSON parser input or file errors', async () => {
    const path = await inputFile('{"password":"never-echo-this",');
    expect(await readManifestFile(path)).toEqual({ ok: false, error: { code: 'validation', message: 'Manifest must be valid JSON' } });
    expect(await readManifestFile(join(path, 'missing'))).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it.each(['plan', 'apply', 'drift'])('%s emits one failure envelope and uses the validation exit code', async (command) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const path = await inputFile('not JSON');
    await program().parseAsync(['--json', 'shop', command, '--manifest', path], { from: 'user' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });

  it('emits the drift diff in one successful envelope but exits 1 when a managed setting differs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(init?.method).toBe('GET');
      const path = new URL(String(input)).pathname;
      const data = path === '/api/me' ? { userId: 'u1', email: 'owner@togethercommunity.app', name: 'Owner', emailVerified: true, tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: 'owner', memberId: null, banned: false } }
        : path === '/api/tenant/settings' ? { settings: tenantSettingsSchema.parse({ name: 'Acme', billingPortalUrl: null, bunnyStreamLibraryId: null }) } : { products: [] };
      return Response.json({ ok: true, data });
    });
    const path = await inputFile(JSON.stringify({ version: 1, company: { settings: { invoiceSellerName: 'Studio' } }, shops: [{ workspace: 'acme', products: [] }] }));
    await program().parseAsync(['shop', 'drift', '--manifest', path], { from: 'user' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: true, data: { drifted: true, shops: [{ settings: { change: ['invoiceSellerName'] } }] } });
    expect(process.exitCode).toBe(1);
  });

  it('passes the integrations opt-in and environment values only to the existing configure route', async () => {
    vi.stubEnv('SHOP_STRIPE_KEY', 'rk_test_private-fixture');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      calls.push(`${init?.method} ${url.pathname}`);
      const data = url.pathname === '/api/me' ? { userId: 'u1', email: 'owner@togethercommunity.app', name: 'Owner', emailVerified: true, tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: 'owner', memberId: null, banned: false } }
        : url.pathname === '/api/tenant/settings' ? { settings: tenantSettingsSchema.parse({ name: 'Acme', billingPortalUrl: null, bunnyStreamLibraryId: null }) }
          : url.pathname === '/api/integrations/stripe/configure' ? { mode: 'test', webhookUrl: 'https://acme.togethercommunity.app/api/stripe/webhook?mode=test' } : { products: [] };
      if (init?.method === 'POST') {
        expect(url.pathname).toBe('/api/integrations/stripe/configure');
        expect(JSON.parse(String(init.body))).toEqual({ mode: 'test', restrictedKey: 'rk_test_private-fixture' });
      }
      return Response.json({ ok: true, data });
    });
    const path = await inputFile(JSON.stringify({ version: 1, company: { integrations: { stripe: { restrictedKeyEnv: 'SHOP_STRIPE_KEY', mode: 'test' } } }, shops: [{ workspace: 'acme', products: [] }] }));
    await program().parseAsync(['shop', 'apply', '--manifest', path], { from: 'user' });
    expect(calls.every((call) => call.startsWith('GET '))).toBe(true);
    await program().parseAsync(['shop', 'apply', '--manifest', path, '--integrations'], { from: 'user' });
    expect(calls.filter((call) => call.startsWith('POST '))).toEqual(['POST /api/integrations/stripe/configure']);
    expect(log).toHaveBeenCalledTimes(2);
    for (const call of log.mock.calls) expect(String(call[0])).not.toContain('rk_test_private-fixture');
  });

  it.each(['plan', 'apply', 'drift'])('%s sends the session and shop selector through the typed client without writes for an empty catalogue', async (command) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(new URL(String(input)).hostname).toBe('acme.togethercommunity.app');
      expect(init?.headers).toMatchObject({ authorization: 'Bearer session-fixture', 'x-tenant': 'acme' });
      expect(init?.method).toBe('GET');
      const path = new URL(String(input)).pathname;
      const data = path === '/api/me' ? { userId: 'u1', email: 'owner@togethercommunity.app', name: 'Owner', emailVerified: true, tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: 'owner', memberId: null, banned: false } }
        : path === '/api/tenant/settings' ? { settings: tenantSettingsSchema.parse({ name: 'Acme', billingPortalUrl: null, bunnyStreamLibraryId: null }) } : { products: [] };
      return new Response(JSON.stringify({ ok: true, data }), { headers: { 'content-type': 'application/json' } });
    });
    const path = await inputFile(JSON.stringify({ version: 1, shops: [{ workspace: 'acme', products: [] }] }));
    await program().parseAsync(['--json', 'shop', command, '--manifest', path, '--shop', 'acme'], { from: 'user' });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: true, data: { shops: [{ workspace: 'acme', products: [] }] } });
    expect(String(log.mock.calls[0]?.[0])).not.toContain('session-fixture');
  });
});
