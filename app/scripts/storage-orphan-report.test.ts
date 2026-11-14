import { afterEach, describe, expect, it, vi } from 'vitest';

import { ok } from '#core/domain/index.js';

import { createStorageReportProvider, parseStorageReportArgs } from './storage-orphan-report.js';

const { fetchStorage } = vi.hoisted(() => ({
  fetchStorage: vi.fn(async () => new Response('<ListBucketResult><EncodingType>url</EncodingType><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>')),
}));

vi.mock('undici', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  fetch: fetchStorage,
}));

afterEach(() => vi.clearAllMocks());

describe('storage report private endpoints', () => {
  const resolver = { resolve: async () => ok('configured') };
  const input = {
    configuration: {
      provider: 'minio' as const,
      endpoint: 'http://127.0.0.1:19000',
      region: 'us-east-1',
      bucket: 'together-test',
      accessKeyId: 'test-access',
      secretAccessKey: 'test-secret',
    },
    prefix: 'tenants/tenant-1/',
    continuationToken: null,
    limit: 10,
  };

  it('allows listing a private endpoint only with the explicit true opt-in', async () => {
    const storage = createStorageReportProvider(resolver, { STORAGE_ALLOW_PRIVATE_ENDPOINTS: 'true' });
    expect(await storage.list(input)).toMatchObject({ ok: true, value: { objects: [], continuationToken: null } });
    expect(fetchStorage).toHaveBeenCalledOnce();
  });

  it.each([{}, { STORAGE_ALLOW_PRIVATE_ENDPOINTS: 'false' }])('refuses private endpoints with settings %j', async (env) => {
    const storage = createStorageReportProvider(resolver, env);
    expect(await storage.list(input)).toMatchObject({ ok: false });
    expect(fetchStorage).not.toHaveBeenCalled();
  });

  it('rejects invalid opt-in values', () => {
    expect(() => createStorageReportProvider(resolver, { STORAGE_ALLOW_PRIVATE_ENDPOINTS: 'yes' })).toThrow();
  });
});

describe('storage report arguments', () => {
  it('defaults to a 24-hour report and supports JSON and an explicit grace period', () => {
    expect(parseStorageReportArgs(['--tenant', 'acme'])).toMatchObject({
      help: false, json: false, input: { tenantId: 'acme', graceHours: 24 },
    });
    expect(parseStorageReportArgs(['--tenant', 'acme', '--json', '--grace-hours', '72'])).toMatchObject({
      help: false, json: true, input: { tenantId: 'acme', graceHours: 72 },
    });
  });

  it('rejects apply mode, missing tenant and invalid grace periods', () => {
    for (const args of [[], ['--tenant', 'acme', '--apply'], ['--tenant', 'acme', '--grace-hours', '-1'],
      ['--tenant', 'acme', '--grace-hours', 'invalid']]) {
      expect(() => parseStorageReportArgs(args)).toThrow();
    }
  });

  it('offers help without requiring credentials', () => {
    expect(parseStorageReportArgs(['--help'])).toEqual({ help: true });
  });
});
