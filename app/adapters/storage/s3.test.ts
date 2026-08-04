import { describe, expect, it } from 'vitest';

import { err, notFound, ok, type StorageConfiguration } from '#core/domain/index.js';

import { createS3StorageProvider, mapStorageProbeFailure } from './s3.js';

const resolver = {
  resolve: async (_tenantId: string, key: string) =>
    key === 's3.configuration' ? err(notFound('not configured')) : ok('configured'),
};

const MINIO_CONFIGURATION: StorageConfiguration = {
  provider: 'minio',
  endpoint: 'http://127.0.0.1:19000',
  region: 'us-east-1',
  bucket: 'together-test',
  accessKeyId: 'minio-access',
  secretAccessKey: 'minio-secret',
};

const storageResponse = (
  status: number,
  body: string,
  responseHeaders: Record<string, string> = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'PUT',
    'access-control-allow-headers': 'content-type',
  },
) => ({
  ok: status < 400,
  status,
  headers: {
    get: (name: string) => responseHeaders[name.toLowerCase()] ?? null,
  },
  text: async () => body,
});

const fakeBucket = (failure?: {
  method: 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PUT';
  status: number;
  body: string;
  headers?: Record<string, string>;
}) => {
  const requests: Array<{
    method: string;
    url: string;
    headers?: Record<string, string>;
    dispatcher?: unknown;
    redirect?: 'error';
  }> = [];
  const objects = new Map<string, string>();
  const fetchStorage = async (
    url: string,
    init: {
      method: 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PUT';
      body?: string;
      headers?: Record<string, string>;
      dispatcher?: unknown;
      redirect?: 'error';
    },
  ) => {
    requests.push({
      method: init.method,
      url,
      ...(init.headers === undefined ? {} : { headers: init.headers }),
      ...(init.dispatcher === undefined ? {} : { dispatcher: init.dispatcher }),
      ...(init.redirect === undefined ? {} : { redirect: init.redirect }),
    });
    const path = new URL(url).pathname;
    if (failure !== undefined && failure.method === init.method) {
      return storageResponse(failure.status, failure.body, failure.headers);
    }
    if (init.method === 'OPTIONS') return storageResponse(204, '');
    if (init.method === 'PUT') {
      objects.set(path, init.body ?? '');
      return storageResponse(200, '');
    }
    if (init.method === 'GET') {
      const stored = objects.get(path);
      return stored === undefined
        ? storageResponse(404, '<Error><Code>NoSuchKey</Code></Error>')
        : storageResponse(200, stored);
    }
    if (init.method === 'HEAD') {
      const stored = objects.get(path);
      return stored === undefined
        ? storageResponse(404, '<Error><Code>NoSuchKey</Code></Error>')
        : storageResponse(200, '', { 'content-length': String(Buffer.byteLength(stored)) });
    }
    objects.delete(path);
    return storageResponse(204, '');
  };
  return { fetchStorage, objects, requests };
};

const DOCS_EXAMPLE = {
  url: 'https://examplebucket.s3.amazonaws.com/test.txt',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  expiresInSeconds: 86400,
};

describe('createS3StorageProvider', () => {
  it('reproduces the AWS documentation presign example byte for byte', () => {
    const signer = createS3StorageProvider(resolver, {
      now: () => new Date('2013-05-24T00:00:00.000Z'),
    });
    const result = signer.presignGet(DOCS_EXAMPLE);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z' +
        '&X-Amz-Expires=86400' +
        '&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('extracts the region from regional virtual-hosted hosts', () => {
    const signer = createS3StorageProvider(resolver, {
      now: () => new Date('2026-07-20T12:00:00.000Z'),
    });
    const result = signer.presignGet({
      url: 'https://legacy-pdf-bucket-example.s3.eu-central-1.amazonaws.com/pdf-files/handout.pdf',
      accessKeyId: 'AKIA-TEST',
      secretAccessKey: 'secret',
      expiresInSeconds: 3600,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toContain('%2Feu-central-1%2Fs3%2Faws4_request');
    expect(result.value).toContain('X-Amz-Date=20260720T120000Z');
    expect(result.value.startsWith('https://legacy-pdf-bucket-example.s3.eu-central-1.amazonaws.com/pdf-files/handout.pdf?')).toBe(true);
  });

  it('percent-encodes path segments into the canonical URI', () => {
    const signer = createS3StorageProvider(resolver, {
      now: () => new Date('2026-07-20T12:00:00.000Z'),
    });
    const result = signer.presignGet({
      url: 'https://bucket.s3.eu-central-1.amazonaws.com/pdf files/no(1)*.pdf',
      accessKeyId: 'AKIA-TEST',
      secretAccessKey: 'secret',
      expiresInSeconds: 60,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toContain('/pdf%20files/no%281%29%2A.pdf?');
  });

  it('rejects URLs that are not virtual-hosted S3', () => {
    const signer = createS3StorageProvider(resolver);
    const result = signer.presignGet({
      url: 'https://cdn.example.com/file.pdf',
      accessKeyId: 'AKIA-TEST',
      secretAccessKey: 'secret',
      expiresInSeconds: 60,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation');
  });

  it('presigns path-style S3-compatible URLs with the configured region', () => {
    const signer = createS3StorageProvider(resolver, {
      now: () => new Date('2026-08-03T12:00:00.000Z'),
    });
    const result = signer.presignPut({
      url: 'http://127.0.0.1:19000/together-test/lesson-attachments/a/file.pdf',
      accessKeyId: 'minio-access',
      secretAccessKey: 'minio-secret',
      region: 'us-east-1',
      expiresInSeconds: 900,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toContain('%2Fus-east-1%2Fs3%2Faws4_request');
    expect(result.value).toContain('/together-test/lesson-attachments/a/file.pdf?');
  });

  it('builds one encoded object URL for probes and attachment operations', () => {
    const storage = createS3StorageProvider(resolver);

    expect(storage.objectUrl({
      ...MINIO_CONFIGURATION,
      endpoint: 'https://storage.example.test/tenant/prefix/',
      bucket: 'creator-files',
    }, 'lesson attachments/zażółć (1).pdf').toString()).toBe(
      'https://storage.example.test/tenant/prefix/creator-files/lesson%20attachments/za%C5%BC%C3%B3%C5%82%C4%87%20%281%29.pdf',
    );
  });

  it('rejects unparsable URLs', () => {
    const signer = createS3StorageProvider(resolver);
    const result = signer.presignGet({
      url: 'not a url',
      accessKeyId: 'AKIA-TEST',
      secretAccessKey: 'secret',
      expiresInSeconds: 60,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation');
  });

  it('presigns PUT uploads and signs DELETE requests', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const storage = createS3StorageProvider(
      resolver,
      {
        now: () => new Date('2026-07-20T12:00:00.000Z'),
        fetchStorage: async (url, init) => {
          requests.push({ url, method: init.method });
          return storageResponse(204, '');
        },
      },
    );
    const put = storage.presignPut({ ...DOCS_EXAMPLE, expiresInSeconds: 300 });
    if (!put.ok) throw new Error(put.error.message);
    expect(put.value).toContain('X-Amz-Signature=');

    const deleted = await storage.delete(DOCS_EXAMPLE);
    expect(deleted).toEqual({ ok: true, value: { deleted: true } });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('DELETE');
    expect(requests[0]?.url).toContain('X-Amz-Signature=');
  });

  it('reads the stored object size through a signed HEAD request', async () => {
    const bucket = fakeBucket();
    const storage = createS3StorageProvider(resolver, {
      now: () => new Date('2026-08-03T12:00:00.000Z'),
      fetchStorage: bucket.fetchStorage,
    });
    const target = storage.objectUrl(MINIO_CONFIGURATION, 'attachments/file.txt').toString();
    await bucket.fetchStorage(target, { method: 'PUT', body: 'actual bytes' });

    await expect(storage.head({
      url: target,
      accessKeyId: MINIO_CONFIGURATION.accessKeyId,
      secretAccessKey: MINIO_CONFIGURATION.secretAccessKey,
      region: MINIO_CONFIGURATION.region,
    })).resolves.toEqual({ ok: true, value: { sizeBytes: 12 } });
    expect(bucket.requests.at(-1)?.method).toBe('HEAD');
    expect(bucket.requests.at(-1)?.url).toContain('X-Amz-Signature=');
  });

  it('uses the shared diagnostic contract after checking both stored credentials', async () => {
    const keys: string[] = [];
    const storage = createS3StorageProvider({
      resolve: async (_tenantId, key) => {
        keys.push(key);
        return key === 's3.accessKeyId' || key === 's3.secretAccessKey'
          ? ok('configured')
          : err(notFound('missing'));
      },
    });

    await expect(storage.healthcheck({ tenantId: 'tenant-1' })).resolves.toEqual({
      ok: true,
      value: { healthy: true },
    });
    await expect(storage.test({ tenantId: 'tenant-1' })).resolves.toEqual({
      ok: true,
      value: { code: 'storage.available', message: 'Storage credentials are available.' },
    });
    expect(keys).toEqual([
      's3.accessKeyId',
      's3.secretAccessKey',
      's3.configuration',
      's3.accessKeyId',
      's3.secretAccessKey',
    ]);
  });

  it.each(['s3.accessKeyId', 's3.secretAccessKey'])('maps a missing %s to not configured', async (missingKey) => {
    const storage = createS3StorageProvider({
      resolve: async (_tenantId, key) =>
        key === missingKey || key === 's3.configuration'
          ? err(notFound('missing'))
          : ok('configured'),
    });

    await expect(storage.test({ tenantId: 'tenant-1' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'integration_not_configured' },
    });
  });

  it('writes, reads back and deletes one signed scratch object during the live probe', async () => {
    const bucket = fakeBucket();
    const storage = createS3StorageProvider(
      resolver,
      {
        now: () => new Date('2026-08-03T12:00:00.000Z'),
        fetchStorage: bucket.fetchStorage,
        probeKey: () => 'probe-id',
        allowPrivateEndpoints: true,
      },
    );

    await expect(storage.probe(MINIO_CONFIGURATION)).resolves.toEqual({
      ok: true,
      value: {
        code: 'storage.available',
        message: 'Storage completed the write, read and delete probe.',
      },
    });
    expect(bucket.requests.map((request) => request.method)).toEqual(['PUT', 'GET', 'DELETE', 'OPTIONS']);
    expect(bucket.requests[3]?.headers).toEqual({
      Origin: 'http://localhost:48730',
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type',
    });
    for (const request of bucket.requests) {
      expect(request.dispatcher).toBeDefined();
      expect(request.redirect).toBe('error');
      expect(request.url).toContain('X-Amz-Signature=');
      expect(request.url.startsWith(
        'http://127.0.0.1:19000/together-test/together-probe/probe-id.txt?',
      )).toBe(true);
    }
    expect(bucket.objects.size).toBe(0);
  });

  it('probes AWS buckets on their virtual-hosted host', async () => {
    const bucket = fakeBucket();
    const storage = createS3StorageProvider(
      resolver,
      {
        now: () => new Date('2026-08-03T12:00:00.000Z'),
        fetchStorage: bucket.fetchStorage,
        probeKey: () => 'probe-id',
        lookupAddresses: async () => ['52.219.170.0'],
      },
    );

    await expect(
      storage.probe({
        provider: 'aws_s3',
        endpoint: 'https://s3.eu-central-1.amazonaws.com',
        region: 'eu-central-1',
        bucket: 'together-docs',
        accessKeyId: 'AKIA-TEST',
        secretAccessKey: 'secret',
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(bucket.requests[0]?.url.startsWith(
      'https://together-docs.s3.eu-central-1.amazonaws.com/together-probe/probe-id.txt?',
    )).toBe(true);
    expect(bucket.requests[0]?.url).toContain('%2Feu-central-1%2Fs3%2Faws4_request');
  });

  it('deletes the scratch object even when reading it back fails', async () => {
    const bucket = fakeBucket({
      method: 'GET',
      status: 403,
      body: '<Error><Code>SignatureDoesNotMatch</Code></Error>',
    });
    const storage = createS3StorageProvider(resolver, {
      now: () => new Date(),
      fetchStorage: bucket.fetchStorage,
      allowPrivateEndpoints: true,
    });

    await expect(storage.probe(MINIO_CONFIGURATION)).resolves.toMatchObject({
      ok: false,
      error: { code: 'integration_auth', details: { providerCode: 'storage.credentials' } },
    });
    expect(bucket.requests.map((request) => request.method)).toEqual(['PUT', 'GET', 'DELETE']);
    expect(bucket.objects.size).toBe(0);
  });

  it('fails the probe when the bucket returns different content', async () => {
    const bucket = fakeBucket({ method: 'GET', status: 200, body: 'someone else content' });
    const storage = createS3StorageProvider(resolver, {
      now: () => new Date(),
      fetchStorage: bucket.fetchStorage,
      allowPrivateEndpoints: true,
    });

    await expect(storage.probe(MINIO_CONFIGURATION)).resolves.toMatchObject({
      ok: false,
      error: { details: { providerCode: 'storage.unavailable' } },
    });
  });

  it('maps an unreachable endpoint to the unavailable code', async () => {
    const storage = createS3StorageProvider(resolver, {
      now: () => new Date(),
      fetchStorage: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:19000');
      },
      allowPrivateEndpoints: true,
    });

    await expect(storage.probe(MINIO_CONFIGURATION)).resolves.toMatchObject({
      ok: false,
      error: { code: 'integration_unavailable', details: { providerCode: 'storage.unavailable' } },
    });
  });

  it('rejects private endpoint addresses before sending a probe request', async () => {
    const requests: string[] = [];
    const storage = createS3StorageProvider(resolver, {
      fetchStorage: async (url) => {
        requests.push(url);
        return storageResponse(204, '');
      },
    });

    for (const endpoint of [
      'http://127.0.0.1:9000',
      'http://169.254.169.254',
      'http://10.0.0.8',
      'http://172.16.0.8',
      'http://192.168.0.8',
      'http://[::1]:9000',
    ]) {
      await expect(storage.probe({ ...MINIO_CONFIGURATION, endpoint })).resolves.toMatchObject({
        ok: false,
        error: { details: { providerCode: 'storage.unavailable' } },
      });
    }
    await expect(storage.probe({
      ...MINIO_CONFIGURATION,
      provider: 'aws_s3',
      endpoint: 'http://127.0.0.1:9000',
    })).resolves.toMatchObject({
      ok: false,
      error: { details: { providerCode: 'storage.unavailable' } },
    });
    expect(requests).toEqual([]);
  });

  it('rejects public hostnames that resolve to private addresses', async () => {
    const requests: string[] = [];
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['203.0.113.8', '169.254.169.254'],
      fetchStorage: async (url) => {
        requests.push(url);
        return storageResponse(204, '');
      },
    });

    await expect(storage.probe({
      ...MINIO_CONFIGURATION,
      endpoint: 'https://storage.example.test',
    })).resolves.toMatchObject({
      ok: false,
      error: { details: { providerCode: 'storage.unavailable' } },
    });
    expect(requests).toEqual([]);
  });

  it('maps a failed browser preflight to the CORS diagnostic', async () => {
    const bucket = fakeBucket({
      method: 'OPTIONS',
      status: 204,
      body: '',
      headers: {
        'access-control-allow-origin': 'https://another.example',
        'access-control-allow-methods': 'GET',
      },
    });
    const storage = createS3StorageProvider(resolver, {
      fetchStorage: bucket.fetchStorage,
      allowPrivateEndpoints: true,
      corsOrigin: 'https://app.together.example/path',
    });

    await expect(storage.probe(MINIO_CONFIGURATION)).resolves.toMatchObject({
      ok: false,
      error: { details: { providerCode: 'storage.cors' } },
    });
    expect(bucket.requests.map((request) => request.method)).toEqual(['PUT', 'GET', 'DELETE', 'OPTIONS']);
    expect(bucket.requests[3]?.headers).toEqual({
      Origin: 'https://app.together.example',
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type',
    });
  });

  it.each([
    [301, '<Error><Code>PermanentRedirect</Code></Error>', 'storage.wrong_region'],
    [400, '<Error><Code>AuthorizationHeaderMalformed</Code></Error>', 'storage.wrong_region'],
    [404, '<Error><Code>NoSuchBucket</Code></Error>', 'storage.bucket'],
    [403, '<Error><Code>InvalidAccessKeyId</Code></Error>', 'storage.credentials'],
    [403, '<Error><Code>SignatureDoesNotMatch</Code></Error>', 'storage.credentials'],
    [403, '<Error><Code>CORSForbidden</Code></Error>', 'storage.cors'],
    [500, '<Error><Code>InternalError</Code></Error>', 'storage.unavailable'],
  ])('maps status %i to an actionable machine code', (status, body, providerCode) => {
    expect(mapStorageProbeFailure(status, body)).toMatchObject({ details: { providerCode } });
  });

  it('runs the live CRUD probe for the saved configuration diagnostic', async () => {
    const bucket = fakeBucket();
    const storage = createS3StorageProvider(
      { resolve: async () => ok(JSON.stringify(MINIO_CONFIGURATION)) },
      {
        now: () => new Date(),
        fetchStorage: bucket.fetchStorage,
        probeKey: () => 'saved-probe',
        allowPrivateEndpoints: true,
      },
    );

    await expect(storage.test({ tenantId: 'tenant-1' })).resolves.toMatchObject({
      ok: true,
      value: { code: 'storage.available' },
    });
    await expect(storage.healthcheck({ tenantId: 'tenant-1' })).resolves.toEqual({
      ok: true,
      value: { healthy: true },
    });
    expect(bucket.requests.map((request) => request.method)).toEqual(['PUT', 'GET', 'DELETE', 'OPTIONS']);
  });

  it('reports the stored configuration as invalid instead of leaking its content', async () => {
    const storage = createS3StorageProvider({ resolve: async () => ok('{"provider":"minio"}') });

    await expect(storage.test({ tenantId: 'tenant-1' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'integration_not_configured' },
    });
  });
});
