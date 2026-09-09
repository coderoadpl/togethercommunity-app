import { writeFile, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiClient } from '#core/client/index.js';
import { type ImpersonationPrincipal, type TenantApiKeyScope } from '#core/domain/index.js';
import { tenantDomainRepositoryStub } from '#core/server/testing/tenant-domain-fakes.js';
import { createDirectoryFixture, directoryCtx, directoryValue } from '#adapters/db/marketing-contact-test-fixture.js';

import { createMarketingContactTestApp } from '../apps/server/testing/marketing-contact-test-app.js';

let fixture: Awaited<ReturnType<typeof createDirectoryFixture>>;
beforeAll(async () => { fixture = await createDirectoryFixture(); }, 60_000);
afterAll(async () => { await fixture?.close(); });
const application = (scope: TenantApiKeyScope = 'marketing', impersonation?: ImpersonationPrincipal) => {
  const tenant = { id: 'directory-a', slug: 'acme', name: 'Acme', createdAt: '2026-09-08T10:00:00.000Z', status: 'active' as const, plan: 'self_hosted' as const, contentVersion: 1 };
  const unexpected = (): never => { throw new Error('Unexpected dependency call'); };
  const deps: Parameters<typeof createMarketingContactTestApp>[0] = {
    marketingContacts: fixture.deps, baseDomain: 'example.org', platformHost: null, singleTenantMode: true,
    clock: fixture.deps.clock, ids: fixture.deps.ids, marketingImportCronSecret: 'test-worker-secret', marketingDirectoryJobs: { tenantIds: async () => ['directory-a'] },
    tenants: { findById: async () => tenant, findBySlug: async () => tenant, findSole: async () => tenant, findSettings: unexpected, updateSettings: unexpected, createTenantWithOwnerGrant: unexpected, hasAny: async () => true },
    tenantDomains: tenantDomainRepositoryStub({}), apiKeyCrypto: { hash: (value) => value, generateSecret: unexpected },
    tenantApiKeys: { findActiveByHash: async (_tenantId, key) => key !== 'secret' ? null : { id: 'key-real-id', tenantId: tenant.id, name: 'Test key', scopes: [scope], keyHash: key, createdAt: tenant.createdAt, revokedAt: null, expiresAt: null }, listByTenant: unexpected, create: unexpected, revoke: unexpected },
  };
  return createMarketingContactTestApp(deps, directoryCtx().identity, impersonation);
};
describe('marketing directory HTTP routes', () => {
  it('executes the real CLI against an ephemeral HTTP server and local PostgreSQL', async () => {
    const app = application();
    const server = app.listen();
    const csvFile = `.contacts-cli-runtime-${crypto.randomUUID()}.csv`;
    try {
      await new Promise<void>((resolve) => { if (server.listening) resolve(); else server.once('listening', resolve); });
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('Expected a bound TCP port');
      const cli = async (...args: string[]): Promise<unknown> => {
        const stdout = await new Promise<string>((resolve, reject) => {
          execFile(process.execPath, ['--import', 'tsx', 'apps/cli/src/main.ts', '--json', '--api-url', `http://127.0.0.1:${address.port}`, '--tenant', 'acme', 'marketing', ...args, '--api-key-env', 'CONTACTS_TEST_API_KEY'], { env: { ...process.env, CONTACTS_TEST_API_KEY: 'secret' }, timeout: 20_000 }, (error, output) => { if (error) reject(error); else resolve(output); });
        });
        return JSON.parse(stdout);
      };
      expect(await cli('contacts', 'list')).toEqual({ ok: true, data: { contacts: [], nextCursor: null } });
      await writeFile(csvFile, 'email,name,tags,lists\ncli-dry-run@example.test,CLI Example,example,cli-list\n');
      const validation = await cli('contacts', 'import', csvFile, '--dry-run', '--idempotency-key', 'cli-runtime');
      expect(validation).toMatchObject({ ok: true, data: { canCommit: true, counts: { validRows: 1, listsToCreate: ['cli-list'] } } });
      expect(await fixture.deps.contacts.findByEmail('directory-a', 'cli-dry-run@example.test')).toBeNull();
      const staged = await fixture.deps.imports.findByKey('directory-a', 'cli-runtime');
      if (staged === null) throw new Error('Expected staged CLI import');
      expect(await cli('contacts', 'import', csvFile, '--resume', staged.id, '--attest', '--attestation-note', 'Synthetic CLI import; authorization evidence retained.', '--no-wait')).toMatchObject({ ok: true, data: { import: { id: staged.id, status: 'queued' } } });
      const queued = await fixture.deps.imports.findById('directory-a', staged.id);
      if (queued === null) throw new Error('Expected committed CLI import');
      await fixture.deps.imports.save('directory-a', { ...queued, status: 'failed', lastError: 'Simulated worker interruption' });
      expect(await cli('contacts', 'import', csvFile, '--resume', staged.id, '--dry-run')).toMatchObject({ ok: true, data: { import: { status: 'failed' } } });
      expect((await fixture.deps.imports.findById('directory-a', staged.id))?.status).toBe('failed');
      expect(await cli('contacts', 'import', csvFile, '--resume', staged.id, '--no-wait')).toMatchObject({ ok: true, data: { import: { status: 'queued' } } });
      expect((await app.request('/api/internal/marketing/imports/tick', { headers: { authorization: 'Bearer test-worker-secret' } })).status).toBe(200);
      expect(await cli('contacts', 'import', csvFile, '--resume', staged.id)).toMatchObject({ ok: true, data: { import: { status: 'completed', resultCounts: { created: 1, membershipsAdded: 1 } } } });
      expect(await cli('contacts', 'export', '--list', 'cli-list')).toMatchObject({ ok: true, data: { rowCount: 1, csv: expect.stringContaining('cli-dry-run@example.test') } });
      expect(await cli('contacts', 'import', csvFile, '--idempotency-key', 'cli-runtime', '--attest', '--attestation-note', 'Synthetic CLI import; authorization evidence retained.')).toMatchObject({ ok: true, data: { import: { id: staged.id, status: 'completed' } } });
      await writeFile(csvFile, 'email\ncli-suppressed@example.test\n');
      const suppression = await cli('suppressions', 'import', csvFile, '--default-reason', 'manual', '--default-at', '2025-02-03T10:00:00Z', '--idempotency-key', 'cli-legacy-suppression', '--attest', '--attestation-note', 'Synthetic legacy suppression; evidence retained.', '--no-wait');
      expect(suppression).toMatchObject({ ok: true, data: { import: { status: 'queued', defaults: { reason: 'manual', at: '2025-02-03T10:00:00.000Z' } } } });
      expect((await app.request('/api/internal/marketing/imports/tick', { headers: { authorization: 'Bearer test-worker-secret' } })).status).toBe(200);
      expect(await fixture.deps.suppressions.findActive('directory-a', fixture.deps.hmac.compute('directory-a', 'cli-suppressed@example.test'))).toMatchObject({ reason: 'manual', createdAt: '2025-02-03T10:00:00.000Z' });
    } finally {
      await unlink(csvFile).catch((error: unknown) => { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; });
      await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve(); }); });
    }
  });

  it('stages multipart CSV, attests, runs the durable worker and exports through the typed client', async () => {
    const app = application();
    const api = createApiClient({ baseUrl: 'https://courses.example.org', fetchImpl: async (url, init) => app.request(new Request(url, init)) });
    const preview = directoryValue(await api.uploadMarketingContactImport({ csv: 'email,name,lists\nhttp@example.test,HTTP Example,http-list\n', metadata: { kind: 'contacts', datasetVersion: 'together-marketing-contacts/v1', fileName: 'contacts.csv', idempotencyKey: 'http-upload' } }));
    expect(preview.canCommit).toBe(true);
    const committed = await app.request(`/api/marketing/contact-imports/${preview.import.id}/commit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ validationHash: preview.validationHash, attestation: { accepted: true, version: 'marketing-import-attestation/v1', locale: 'en', note: 'Synthetic directory import with authorization evidence.' } }) });
    expect(committed.status).toBe(202);
    expect((await app.request('/api/internal/marketing/imports/tick')).status).toBe(401);
    expect((await app.request('/api/internal/marketing/imports/tick', { headers: { authorization: 'Bearer test-worker-secret' } })).status).toBe(200);
    expect(directoryValue(await api.exportMarketingContacts({ search: 'http@example.test' })).contacts).toMatchObject([{ email: 'http@example.test' }]);
  });
  it('preserves impersonation context so session directory writes remain read-only', async () => {
    const app = application('marketing', { id: 'impersonation', actorUserId: 'operator', actorEmail: 'operator@example.test', actorName: 'Operator', actorStaffRole: 'owner', subjectMemberId: 'subject', subjectName: 'Subject', expiresAt: '2026-09-08T11:00:00.000Z' });
    const response = await app.request('/api/marketing/contacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'impersonated@example.test' }) });
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'impersonation_read_only' } });
    expect(await fixture.deps.contacts.findByEmail('directory-a', 'impersonated@example.test')).toBeNull();
  });
  it('uses the real API key actor and denies unrelated scopes', async () => {
    const app = application();
    const headers = { 'content-type': 'application/json', 'x-api-key': 'secret', 'Idempotency-Key': 'header-key' };
    const response = await app.request('/api/m2m/marketing/contact-imports', { method: 'POST', headers, body: JSON.stringify({ kind: 'contacts', datasetVersion: 'together-marketing-contacts/v1', fileName: 'api.csv', rowCount: 1 }) });
    expect(response.status).toBe(200);
    const batch = await fixture.deps.imports.findByKey('directory-a', 'header-key');
    const api = createApiClient({ baseUrl: 'https://courses.example.org', fetchImpl: async (url, init) => app.request(new Request(url, init)) });
    const transport = { apiKey: 'secret' };
    const importId = batch?.id ?? '';
    directoryValue(await api.appendMarketingContactImportRows({ importId, offset: 0, rows: [{ email: 'key@example.test' }] }, transport));
    const preview = directoryValue(await api.validateMarketingContactImport({ importId }, transport));
    const committed = directoryValue(await api.commitMarketingContactImport({ importId, validationHash: preview.validationHash, attestation: { accepted: true, version: 'marketing-import-attestation/v1', locale: 'en', note: 'Synthetic import authorized by a scoped automation key.' } }, transport));
    expect(committed.import.attestedBy).toEqual({ kind: 'api_key', apiKeyId: 'key-real-id' });
    for (const scope of ['enrollment', 'transactional', 'import:content', 'import:users'] as const) {
      expect((await application(scope).request('/api/m2m/marketing/contacts', { headers })).status).toBe(403);
    }
    expect((await app.request('/api/marketing/contacts/id/update', { method: 'POST', headers, body: '[]' })).status).toBe(400);
  });
});
