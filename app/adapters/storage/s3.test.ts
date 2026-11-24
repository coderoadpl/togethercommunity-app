import { createHash, createHmac } from 'node:crypto';

import { Agent } from 'undici';
import { describe, expect, it, vi } from 'vitest';

import { err, notFound, ok, storageFailureIsDefinite, type StorageConfiguration } from '#core/domain/index.js';

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
  body: {
    cancel: async () => undefined,
    getReader: () => {
      let delivered = body === '';
      return {
        read: async () => {
          if (delivered) return { done: true };
          delivered = true;
          return { done: false, value: new TextEncoder().encode(body) };
        },
        cancel: async () => undefined,
        releaseLock: () => undefined,
      };
    },
  },
  headers: {
    get: (name: string) => responseHeaders[name.toLowerCase()] ?? null,
  },
  text: async () => body,
});

const streamedResponse = (status: number, chunks: number | 'endless') => {
  const chunkBytes = chunks === 'endless' ? 8 : 1024;
  let pulled = 0;
  const cancel = vi.fn(async () => undefined);
  const read = async (): Promise<{ done: boolean; value?: Uint8Array }> => {
    if (chunks === 'endless' && pulled > 0) return new Promise(() => undefined);
    if (chunks !== 'endless' && pulled >= chunks * chunkBytes) return { done: true };
    pulled += chunkBytes;
    return { done: false, value: new Uint8Array(chunkBytes).fill(120) };
  };
  const response = {
    ok: status < 400,
    status,
    headers: { get: () => null },
    body: { cancel, getReader: () => ({ read, cancel, releaseLock: () => undefined }) },
    text: async () => {
      let text = '';
      for (let chunk = await read(); !chunk.done; chunk = await read()) {
        text += new TextDecoder().decode(chunk.value);
      }
      return text;
    },
  };
  return { response, cancel, pulled: () => pulled };
};

const probeWithGetResponse = (response: ReturnType<typeof streamedResponse>['response']) => {
  const methods: string[] = [];
  const storage = createS3StorageProvider(resolver, {
    now: () => new Date('2026-08-03T12:00:00.000Z'),
    probeKey: () => 'probe-id',
    allowPrivateEndpoints: true,
    fetchStorage: async (_url, init) => {
      methods.push(init.method);
      return init.method === 'GET' ? response : storageResponse(200, '');
    },
  });
  return { result: storage.probe(MINIO_CONFIGURATION), methods };
};

const fakeBucket = (
  failure?: {
    method: 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PUT';
    status: number;
    body: string;
    headers?: Record<string, string>;
  },
  allowedOrigins?: string[],
  options: { ignoresResponseOverrides?: boolean; refusesResponseOverrides?: boolean } = {},
) => {
  const requests: Array<{
    method: string;
    url: string;
    headers?: Record<string, string>;
    dispatcher?: unknown;
    redirect?: 'error';
  }> = [];
  const objects = new Map<string, string | Uint8Array>();
  const fetchStorage = async (
    url: string,
    init: {
      method: 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PUT';
      body?: string | Uint8Array;
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
    if (init.method === 'OPTIONS') {
      if (allowedOrigins === undefined) return storageResponse(204, '');
      const origin = init.headers?.Origin ?? '';
      return storageResponse(204, '', {
        'access-control-allow-origin': allowedOrigins.includes(origin) ? origin : 'https://denied.example',
        'access-control-allow-methods': 'PUT',
        'access-control-allow-headers': 'content-type',
      });
    }
    if (init.method === 'PUT') {
      objects.set(path, init.body ?? '');
      return storageResponse(200, '');
    }
    if (init.method === 'GET') {
      const stored = objects.get(path);
      const query = new URL(url).searchParams;
      if (options.refusesResponseOverrides === true && query.has('response-content-disposition')) {
        return storageResponse(400, '<Error><Code>InvalidArgument</Code></Error>');
      }
      const overrides = options.ignoresResponseOverrides === true ? {} : {
        ...(query.has('response-content-type') ? { 'content-type': query.get('response-content-type') ?? '' } : {}),
        ...(query.has('response-content-disposition') ? { 'content-disposition': query.get('response-content-disposition') ?? '' } : {}),
      };
      return stored === undefined
        ? storageResponse(404, '<Error><Code>NoSuchKey</Code></Error>')
        : storageResponse(200, typeof stored === 'string' ? stored : new TextDecoder().decode(stored), { 'content-type': 'text/plain', ...overrides });
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

  it('signs the declared content length of a presigned PUT into its canonical request', () => {
    const signer = createS3StorageProvider(resolver, { now: () => new Date('2013-05-24T00:00:00.000Z') });
    const signed = signer.presignPut({ ...DOCS_EXAMPLE, contentLength: 1234 });
    if (!signed.ok) throw new Error(signed.error.message);
    const query = 'X-Amz-Algorithm=AWS4-HMAC-SHA256'
      + '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request'
      + '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=content-length%3Bhost';
    const canonicalRequest = ['PUT', '/test.txt', query, 'content-length:1234', 'host:examplebucket.s3.amazonaws.com', '', 'content-length;host', 'UNSIGNED-PAYLOAD'].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', '20130524T000000Z', '20130524/us-east-1/s3/aws4_request',
      createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const key = ['20130524', 'us-east-1', 's3', 'aws4_request']
      .reduce<Buffer | string>((current, part) => createHmac('sha256', current).update(part).digest(), `AWS4${DOCS_EXAMPLE.secretAccessKey}`);
    const signature = createHmac('sha256', key).update(stringToSign).digest('hex');
    expect(signed.value).toBe(`https://examplebucket.s3.amazonaws.com/test.txt?${query}&X-Amz-Signature=${signature}`);

    const other = signer.presignPut({ ...DOCS_EXAMPLE, contentLength: 1235 });
    const unsized = signer.presignPut(DOCS_EXAMPLE);
    if (!other.ok || !unsized.ok) throw new Error('presign failed');
    const signatureOf = (url: string) => new URL(url).searchParams.get('X-Amz-Signature');
    expect(signatureOf(other.value)).not.toBe(signature);
    expect(new URL(unsized.value).searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(signer.presignPut({ ...DOCS_EXAMPLE, contentLength: -1 })).toMatchObject({ ok: false, error: { code: 'validation' } });
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
    }, 'lesson attachments/resume (1).pdf').toString()).toBe(
      'https://storage.example.test/tenant/prefix/creator-files/lesson%20attachments/resume%20%281%29.pdf',
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
    const requests: Array<{
      url: string;
      method: string;
      dispatcher?: unknown;
      redirect?: 'error';
    }> = [];
    const storage = createS3StorageProvider(
      resolver,
      {
        now: () => new Date('2026-07-20T12:00:00.000Z'),
        lookupAddresses: async () => ['52.216.0.1'],
        fetchStorage: async (url, init) => {
          requests.push({
            url,
            method: init.method,
            ...(init.dispatcher === undefined ? {} : { dispatcher: init.dispatcher }),
            ...(init.redirect === undefined ? {} : { redirect: init.redirect }),
          });
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
    expect(requests[0]?.dispatcher).toBeDefined();
    expect(requests[0]?.redirect).toBe('error');
  });

  it('reads the stored object size through a signed HEAD request', async () => {
    const bucket = fakeBucket();
    const storage = createS3StorageProvider(resolver, {
      now: () => new Date('2026-08-03T12:00:00.000Z'),
      fetchStorage: bucket.fetchStorage,
      allowPrivateEndpoints: true,
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
    expect(bucket.requests.at(-1)?.dispatcher).toBeDefined();
    expect(bucket.requests.at(-1)?.redirect).toBe('error');
  });

  it('answers the entity tag a HEAD response carries', async () => {
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async () => storageResponse(200, '', { 'content-length': '12', etag: '"5d41402abc4b2a76b9719d911017c592"' }),
    });
    expect(await storage.head(DOCS_EXAMPLE)).toEqual({ ok: true, value: { sizeBytes: 12, etag: '"5d41402abc4b2a76b9719d911017c592"' } });
  });

  it('answers the bytes of a GET together with the entity tag of that same response, or null without one', async () => {
    const tagged = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async () => storageResponse(200, 'hello', { 'content-length': '5', etag: '"5d41402abc4b2a76b9719d911017c592"' }),
    });
    expect(await tagged.getObjectVersion?.(DOCS_EXAMPLE, { maxBytes: 10 }))
      .toEqual({ ok: true, value: { bytes: new TextEncoder().encode('hello'), etag: '"5d41402abc4b2a76b9719d911017c592"' } });
    const untagged = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async () => storageResponse(200, 'hello', { 'content-length': '5' }),
    });
    expect(await untagged.getObjectVersion?.(DOCS_EXAMPLE, { maxBytes: 10 })).toEqual({ ok: true, value: { bytes: new TextEncoder().encode('hello'), etag: null } });
    expect(await untagged.getObject(DOCS_EXAMPLE, { maxBytes: 10 })).toEqual({ ok: true, value: new TextEncoder().encode('hello') });
  });

  it('tells an object that does not exist apart from a failed request on HEAD and GET', async () => {
    const bucket = fakeBucket();
    const storage = createS3StorageProvider(resolver, { now: () => new Date('2026-08-03T12:00:00.000Z'), fetchStorage: bucket.fetchStorage, allowPrivateEndpoints: true });
    const input = { url: storage.objectUrl(MINIO_CONFIGURATION, 'attachments/missing.txt').toString(), accessKeyId: 'minio-access', secretAccessKey: 'minio-secret', region: 'us-east-1' };
    expect(await storage.head(input)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await storage.getObject(input, { maxBytes: 10 })).toMatchObject({ ok: false, error: { code: 'not_found' } });

    const failing = createS3StorageProvider(resolver, {
      allowPrivateEndpoints: true,
      fetchStorage: async () => storageResponse(503, '<Error><Code>SlowDown</Code></Error>'),
    });
    expect(await failing.head(input)).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    expect(await failing.getObject(input, { maxBytes: 10 })).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
  });

  it('keeps legacy credentials healthy but requires wizard configuration for the connection test', async () => {
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
    await expect(storage.test({ tenantId: 'tenant-1' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'integration_not_configured' },
    });
    expect(keys).toEqual([
      's3.accessKeyId',
      's3.secretAccessKey',
      's3.configuration',
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
        signedResponseOverrides: 'honoured',
      },
    });
    expect(bucket.requests.map((request) => request.method)).toEqual(['PUT', 'GET', 'GET', 'DELETE', 'OPTIONS']);
    expect(bucket.requests[4]?.headers).toEqual({
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

  it.each([
    ['an error answer', 500, 9 * 1024],
    ['the read-back', 200, 1024],
  ])('stops reading an oversized body on %s at the probe byte ceiling', async (_label, status, maxPulled) => {
    const streamed = streamedResponse(status, 1024);
    const { result, methods } = probeWithGetResponse(streamed.response);

    await expect(result).resolves.toMatchObject({
      ok: false,
      error: { code: 'integration_unavailable', details: { providerCode: 'storage.unavailable' } },
    });
    expect(streamed.pulled()).toBeLessThanOrEqual(maxPulled);
    expect(streamed.cancel).toHaveBeenCalledOnce();
    expect(methods).toEqual(['PUT', 'GET', 'DELETE']);
  });

  it.each([
    ['an error answer', 500],
    ['the read-back', 200],
  ])('gives up on a body that never ends on %s after the probe deadline', async (_label, status) => {
    vi.useFakeTimers();
    try {
      const streamed = streamedResponse(status, 'endless');
      const { result, methods } = probeWithGetResponse(streamed.response);

      await vi.advanceTimersByTimeAsync(10_000);
      await expect(result).resolves.toMatchObject({
        ok: false,
        error: { code: 'integration_unavailable', details: { providerCode: 'storage.unavailable' } },
      });
      expect(streamed.pulled()).toBe(8);
      expect(streamed.cancel).toHaveBeenCalledOnce();
      expect(methods).toEqual(['PUT', 'GET', 'DELETE']);
    } finally {
      vi.useRealTimers();
    }
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

  it.each(['DELETE', 'HEAD'] as const)('revalidates and blocks a rebound hostname before %s', async (method) => {
    const requests: string[] = [];
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['169.254.169.254'],
      fetchStorage: async (url) => {
        requests.push(url);
        return storageResponse(204, '');
      },
    });
    const input = {
      url: 'https://storage.example.test/bucket/object.pdf',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      region: 'eu-central-1',
    };

    const result = method === 'DELETE'
      ? await storage.delete(input)
      : await storage.head(input);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'integration_unavailable', details: { providerCode: 'storage.unavailable' } },
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
    expect(bucket.requests.map((request) => request.method)).toEqual(['PUT', 'GET', 'GET', 'DELETE', 'OPTIONS']);
    expect(bucket.requests[4]?.headers).toEqual({
      Origin: 'https://app.together.example',
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type',
    });
  });

  it('preflights every requested origin and passes when the bucket allows them all', async () => {
    const bucket = fakeBucket(undefined, ['https://acme.together.example', 'https://app.together.example']);
    const storage = createS3StorageProvider(resolver, {
      fetchStorage: bucket.fetchStorage,
      allowPrivateEndpoints: true,
      corsOrigin: 'https://app.together.example',
    });

    await expect(storage.probe(
      MINIO_CONFIGURATION,
      ['https://acme.together.example', 'https://app.together.example'],
    )).resolves.toMatchObject({ ok: true, value: { code: 'storage.available' } });
    expect(bucket.requests.map((request) => request.method)).toEqual(['PUT', 'GET', 'GET', 'DELETE', 'OPTIONS', 'OPTIONS']);
    expect(bucket.requests.slice(4).map((request) => request.headers?.Origin)).toEqual([
      'https://acme.together.example',
      'https://app.together.example',
    ]);
  });

  it('names the rejected tenant origin when only the apex is allowed', async () => {
    const bucket = fakeBucket(undefined, ['https://app.together.example']);
    const storage = createS3StorageProvider(resolver, {
      fetchStorage: bucket.fetchStorage,
      allowPrivateEndpoints: true,
      corsOrigin: 'https://app.together.example',
    });

    await expect(storage.probe(
      MINIO_CONFIGURATION,
      ['https://acme.together.example', 'https://app.together.example'],
    )).resolves.toMatchObject({
      ok: false,
      error: {
        details: { providerCode: 'storage.cors', corsOrigin: 'https://acme.together.example' },
      },
    });
    expect(bucket.requests.map((request) => request.method)).toEqual(['PUT', 'GET', 'GET', 'DELETE', 'OPTIONS']);
  });

  it('reports each deep-health CORS preflight as ok or blocked', async () => {
    const bucket = fakeBucket(undefined, ['https://courses.example.org']);
    const storage = createS3StorageProvider(resolver, {
      fetchStorage: bucket.fetchStorage,
      allowPrivateEndpoints: true,
    });

    await expect(storage.probeCors(MINIO_CONFIGURATION, [
      'https://courses.example.org',
      'https://members.example.org',
    ])).resolves.toEqual([
      { origin: 'https://courses.example.org', status: 'ok' },
      { origin: 'https://members.example.org', status: 'blocked' },
    ]);
  });

  it('reports a 403 preflight as blocked', async () => {
    const bucket = fakeBucket({ method: 'OPTIONS', status: 403, body: '' });
    const storage = createS3StorageProvider(resolver, {
      fetchStorage: bucket.fetchStorage,
      allowPrivateEndpoints: true,
    });

    await expect(storage.probeCors(
      MINIO_CONFIGURATION,
      ['https://courses.example.org'],
    )).resolves.toEqual([{ origin: 'https://courses.example.org', status: 'blocked' }]);
  });

  it('reports a timed-out preflight as unknown', async () => {
    const storage = createS3StorageProvider(resolver, {
      fetchStorage: async () => { throw new DOMException('Timed out', 'TimeoutError'); },
      allowPrivateEndpoints: true,
    });

    await expect(storage.probeCors(
      MINIO_CONFIGURATION,
      ['https://courses.example.org'],
    )).resolves.toEqual([{ origin: 'https://courses.example.org', status: 'unknown' }]);
  });

  it('reports an unreadable preflight response as unknown', async () => {
    const storage = createS3StorageProvider(resolver, {
      fetchStorage: async () => ({
        ok: true,
        status: 204,
        body: { cancel: async () => { throw new Error('connection closed'); } },
        headers: {
          get: (name: string) => ({
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'PUT',
            'access-control-allow-headers': 'content-type',
          })[name.toLowerCase()] ?? null,
        },
        text: async () => '',
      }),
      allowPrivateEndpoints: true,
    });

    await expect(storage.probeCors(
      MINIO_CONFIGURATION,
      ['https://courses.example.org'],
    )).resolves.toEqual([{ origin: 'https://courses.example.org', status: 'unknown' }]);
  });

  it('reports an unresolved endpoint as unknown instead of blaming bucket CORS', async () => {
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => [],
    });

    await expect(storage.probeCors(
      { ...MINIO_CONFIGURATION, endpoint: 'https://storage.example.test' },
      ['https://courses.example.org'],
    )).resolves.toEqual([{ origin: 'https://courses.example.org', status: 'unknown' }]);
  });

  it('bounds a DNS lookup that never settles', async () => {
    vi.useFakeTimers();
    try {
      const storage = createS3StorageProvider(resolver, {
        lookupAddresses: () => new Promise(() => undefined),
      });
      const result = storage.probeCors(
        { ...MINIO_CONFIGURATION, endpoint: 'https://storage.example.test' },
        ['https://courses.example.org'],
      );

      await vi.advanceTimersByTimeAsync(5_000);
      await expect(result).resolves.toEqual([
        { origin: 'https://courses.example.org', status: 'unknown' },
      ]);
    } finally {
      vi.useRealTimers();
    }
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
    expect(bucket.requests.map((request) => request.method)).toEqual(['PUT', 'GET', 'GET', 'DELETE', 'OPTIONS']);
  });

  it('reports the stored configuration as invalid instead of leaking its content', async () => {
    const storage = createS3StorageProvider({ resolve: async () => ok('{"provider":"minio"}') });

    await expect(storage.test({ tenantId: 'tenant-1' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'integration_not_configured' },
    });
  });
});

describe('bounded object reads', () => {
  const credentials = { url: 'https://storage.example.test/bucket/file', accessKeyId: 'key', secretAccessKey: 'secret', region: 'us-east-1' };
  it.each(['100', null, 'invalid'])('rejects Content-Length %s without reading any body bytes', async (length) => {
    const read = vi.fn();
    const cancel = vi.fn(async () => undefined);
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async () => ({ ok: true, status: 200, headers: { get: (name) => name === 'content-length' ? length : null },
        body: { cancel, getReader: () => ({ read, cancel, releaseLock: () => undefined }) }, text: async () => '' }),
    });
    expect(await storage.getObject(credentials, { maxBytes: 10 })).toMatchObject({ ok: false });
    expect(read).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([2, 3, 4])('verifies the declared size against %s streamed bytes', async (size) => {
    let sent = false;
    const cancel = vi.fn(async () => undefined);
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async () => ({ ok: true, status: 200, headers: { get: (name) => name === 'content-length' ? '3' : null },
        body: { cancel, getReader: () => ({
          read: async () => {
            if (sent) return { done: true };
            sent = true;
            return { done: false, value: new Uint8Array(size) };
          }, cancel, releaseLock: () => undefined,
        }) }, text: async () => '' }),
    });
    expect((await storage.getObject(credentials, { maxBytes: 3 })).ok).toBe(size === 3);
    expect(cancel).toHaveBeenCalledTimes(size > 3 ? 1 : 0);
  });
});

describe('image publication storage operations', () => {
  const credentials = { url: 'https://storage.example.test/bucket/candidate', accessKeyId: 'key', secretAccessKey: 'secret', region: 'us-east-1' };

  it.each([
    ['bytes 0-2/3', 206, true],
    ['bytes 0-2/30', 206, false],
    ['bytes 1-3/4', 206, false],
    [null, 206, false],
    [null, 200, true],
  ] as const)('requires a complete bounded response for %s (%s)', async (range, status, accepted) => {
    let read = false;
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async (_url, init) => {
        expect(init.headers?.['Range']).toBe('bytes=0-3');
        expect(init.headers?.['Accept-Encoding']).toBe('identity');
        return {
          ok: true, status,
          headers: { get: (name) => name === 'content-length' ? '3' : name === 'content-range' ? range : null },
          body: {
            cancel: async () => undefined,
            getReader: () => ({
              read: async () => {
                if (read) return { done: true };
                read = true;
                return { done: false, value: new Uint8Array([1, 2, 3]) };
              },
              cancel: async () => undefined,
              releaseLock: () => undefined,
            }),
          },
          text: async () => '',
        };
      },
    });
    expect((await storage.getObject(credentials, { maxBytes: 3, range: true })).ok).toBe(accepted);
    expect(read).toBe(accepted);
  });

  it.each([200, 403])('sends exact publication bytes with server content type and handles status %s', async (status) => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async (url, init) => {
        expect(new URL(url).searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/u);
        expect(init.method).toBe('PUT');
        expect(init.body).toEqual(bytes);
        expect(init.headers).toEqual({ 'content-type': 'image/png' });
        expect(init.redirect).toBe('error');
        return storageResponse(status, '');
      },
    });
    expect((await storage.putObject({ ...credentials, body: bytes, contentType: 'image/png' })).ok).toBe(status === 200);
  });

  it('answers a delete of an object the storage reports missing with the NoSuchKey error code as deleted', async () => {
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async () => storageResponse(404, '<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>NoSuchKey</Code><Key>candidate</Key></Error>'),
    });
    expect(await storage.delete(credentials)).toEqual({ ok: true, value: { deleted: true } });
  });

  it.each([
    ['an empty body', ''],
    ['a proxy page', '<html><body><h1>404 Not Found</h1><p>NoSuchKey</p></body></html>'],
    ['a missing bucket', '<Error><Code>NoSuchBucket</Code></Error>'],
    ['another error code', '<Error><Code>NoSuchUpload</Code></Error>'],
    ['a code that only starts like the missing key', '<Error><Code>NoSuchKeyPolicy</Code></Error>'],
    ['a comment naming the missing key before the real code', '<Error><!-- <Code>NoSuchKey</Code> --><Code>NoSuchBucket</Code></Error>'],
    ['a document cut off after the code', '<Error><Code>NoSuchKey</Code><Message>The specified'],
    ['two codes', '<Error><Code>NoSuchKey</Code><Code>NoSuchBucket</Code></Error>'],
    ['the code nested below the root', '<Error><Details><Code>NoSuchKey</Code></Details></Error>'],
    ['a processing instruction inside the root', '<Error><?note x?><Code>NoSuchKey</Code></Error>'],
    ['content after the root', '<Error><Code>NoSuchKey</Code></Error><Error><Code>NoSuchBucket</Code></Error>'],
  ])('answers a delete refused with 404 and %s as an unknown outcome', async (_label, body) => {
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async () => storageResponse(404, body),
    });
    const deleted = await storage.delete(credentials);
    expect(deleted).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    expect(!deleted.ok && storageFailureIsDefinite(deleted.error)).toBe(false);
  });

  it.each([
    ['larger than the error body bound', 16],
    ['that stalls after its first chunk', 'endless'],
  ] as const)('answers a delete refused with 404 and a body %s as an unknown outcome and cancels the body', async (_label, chunks) => {
    const streamed = streamedResponse(404, chunks);
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async () => streamed.response,
    });
    const deleted = await storage.delete({ ...credentials, deadlineMs: 50 });
    expect(deleted).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    expect(!deleted.ok && storageFailureIsDefinite(deleted.error)).toBe(false);
    if (chunks !== 'endless') expect(streamed.cancel).toHaveBeenCalled();
    expect(streamed.pulled()).toBeLessThanOrEqual(9 * 1024);
  });

  it('reports a read, a versioned read, a digest and a copy answered 404 with NoSuchBucket as a storage error, not as a missing object', async () => {
    const answer = { body: '<Error><Code>NoSuchBucket</Code></Error>' };
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async () => storageResponse(404, answer.body),
    });
    const reads = async () => [
      await storage.getObject(credentials, { maxBytes: 10 }),
      await storage.getObjectVersion?.(credentials, { maxBytes: 10 }),
      await storage.digestObject({ ...credentials, deadlineMs: 1_000 }, { maxBytes: 10, headBytes: 4 }),
    ];
    for (const read of await reads()) expect(read).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    const copied = await storage.copyObject({
      configuration: { provider: 'aws_s3', endpoint: 'https://storage.example.test', region: 'us-east-1', bucket: 'bucket', accessKeyId: 'key', secretAccessKey: 'secret' },
      sourceKey: 'a', key: 'b', deadlineMs: 1_000,
    });
    expect(copied).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    expect(!copied.ok && storageFailureIsDefinite(copied.error)).toBe(true);
    answer.body = '<Error><Code>NoSuchKey</Code></Error>';
    for (const read of await reads()) expect(read).toMatchObject({ ok: false, error: { code: 'not_found' } });
    answer.body = '';
    expect(await storage.head(credentials)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await storage.getObject(credentials, { maxBytes: 10 })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it.each([16, 'endless'] as const)('reports a read answered 404 with an unreadable body (%s) as a storage error', async (chunks) => {
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async () => streamedResponse(404, chunks).response,
    });
    expect(await storage.getObject({ ...credentials, deadlineMs: 50 }, { maxBytes: 10 })).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
  });

  it('reads the whole 404 body of a digest before it closes the connection, so a missing key split across chunks stays a missing key', async () => {
    const events: string[] = [];
    let connection: Agent | null = null;
    const chunks = ['<Error><Code>NoSuch', 'Key</Code></Error>'].map((part) => new TextEncoder().encode(part));
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async (_url, init) => {
        const { dispatcher } = init;
        if (!(dispatcher instanceof Agent)) throw new Error('Expected a pinned dispatcher');
        connection = dispatcher;
        let index = 0;
        return {
          ok: false, status: 404, headers: { get: () => null }, text: async () => '',
          body: {
            cancel: async () => undefined,
            getReader: () => ({
              read: async () => {
                await new Promise((resolve) => { setTimeout(resolve, 5); });
                const value = chunks[index];
                index += 1;
                events.push(`${value === undefined ? 'end' : 'chunk'}${dispatcher.destroyed ? ' after close' : ''}`);
                return value === undefined ? { done: true } : { done: false, value };
              },
              cancel: async () => undefined,
              releaseLock: () => undefined,
            }),
          },
        };
      },
    });
    expect(await storage.digestObject({ ...credentials, deadlineMs: 1_000 }, { maxBytes: 10, headBytes: 4 }))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(events).toEqual(['chunk', 'chunk', 'end']);
    expect(connection?.destroyed).toBe(true);
  });

  it.each([16, 'endless'] as const)('reports a copy answered 404 with an unreadable body (%s) as a storage error without a definite outcome', async (chunks) => {
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async () => streamedResponse(404, chunks).response,
    });
    const copied = await storage.copyObject({
      configuration: { provider: 'aws_s3', endpoint: 'https://storage.example.test', region: 'us-east-1', bucket: 'bucket', accessKeyId: 'key', secretAccessKey: 'secret' },
      sourceKey: 'a', key: 'b', deadlineMs: 50,
    });
    expect(copied).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    expect(!copied.ok && storageFailureIsDefinite(copied.error)).toBe(false);
  });

  it.each([[400, true], [403, true], [500, false], [503, false]] as const)(
    'answers a delete refused with status %s as definite only for a refusal: %s',
    async (status, definite) => {
      const storage = createS3StorageProvider(resolver, {
        lookupAddresses: async () => ['93.184.216.34'],
        fetchStorage: async () => storageResponse(status, '<Error><Code>AccessDenied</Code></Error>'),
      });
      const deleted = await storage.delete(credentials);
      expect(deleted).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
      expect(!deleted.ok && storageFailureIsDefinite(deleted.error)).toBe(definite);
    },
  );

  it('answers a delete whose connection failed as an unknown outcome', async () => {
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async () => { throw new Error('socket hang up'); },
    });
    const deleted = await storage.delete(credentials);
    expect(deleted).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    expect(!deleted.ok && storageFailureIsDefinite(deleted.error)).toBe(false);
  });

  it('stores the disposition it is given with the object', async () => {
    const sent: Array<Record<string, string> | undefined> = [];
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async (_url, init) => {
        sent.push(init.headers);
        return storageResponse(200, '');
      },
    });
    const svg = new TextEncoder().encode('<svg/>');
    expect((await storage.putObject({ ...credentials, body: svg, contentType: 'image/svg+xml', contentDisposition: 'attachment' })).ok).toBe(true);
    expect(sent).toEqual([{ 'content-type': 'image/svg+xml', 'content-disposition': 'attachment' }]);
  });
});

describe('download file storage operations', () => {
  const AWS: StorageConfiguration = {
    provider: 'aws_s3', endpoint: 'https://s3.us-east-1.amazonaws.com', region: 'us-east-1', bucket: 'examplebucket',
    accessKeyId: DOCS_EXAMPLE.accessKeyId, secretAccessKey: DOCS_EXAMPLE.secretAccessKey,
  };

  it('signs a server-side copy whose metadata the server replaces, with the copy source and every header in the canonical request', async () => {
    const sent: Array<{ url: string; headers: Record<string, string> | undefined; method: string }> = [];
    const storage = createS3StorageProvider(resolver, {
      now: () => new Date('2013-05-24T00:00:00.000Z'),
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async (url, init) => {
        sent.push({ url, headers: init.headers, method: init.method });
        return storageResponse(200, '<CopyObjectResult><ETag>"x"</ETag></CopyObjectResult>');
      },
    });
    const result = await storage.copyObject({
      configuration: AWS, sourceKey: 'acme/product-downloads/key-uploads/key 1/upload-1', key: 'acme/product-downloads/key-files/key-1/file-1/a.pdf', deadlineMs: 1_000,
    });
    expect(result).toEqual({ ok: true, value: undefined });
    const [request] = sent;
    if (request === undefined) throw new Error('no request');
    const headers = {
      'cache-control': 'no-store',
      'content-disposition': 'attachment',
      'content-type': 'application/octet-stream',
      'x-amz-copy-source': '/examplebucket/acme/product-downloads/key-uploads/key%201/upload-1',
      'x-amz-metadata-directive': 'REPLACE',
    };
    expect(request.method).toBe('PUT');
    expect(request.headers).toEqual(headers);
    const signedHeaders = 'cache-control;content-disposition;content-type;host;x-amz-copy-source;x-amz-metadata-directive';
    const query = 'X-Amz-Algorithm=AWS4-HMAC-SHA256'
      + '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request'
      + `&X-Amz-Date=20130524T000000Z&X-Amz-Expires=60&X-Amz-SignedHeaders=${encodeURIComponent(signedHeaders)}`;
    const path = '/acme/product-downloads/key-files/key-1/file-1/a.pdf';
    const canonicalRequest = ['PUT', path, query,
      'cache-control:no-store', 'content-disposition:attachment', 'content-type:application/octet-stream',
      'host:examplebucket.s3.us-east-1.amazonaws.com', `x-amz-copy-source:${headers['x-amz-copy-source']}`, 'x-amz-metadata-directive:REPLACE',
      '', signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', '20130524T000000Z', '20130524/us-east-1/s3/aws4_request',
      createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const key = ['20130524', 'us-east-1', 's3', 'aws4_request']
      .reduce<Buffer | string>((current, part) => createHmac('sha256', current).update(part).digest(), `AWS4${DOCS_EXAMPLE.secretAccessKey}`);
    const signature = createHmac('sha256', key).update(stringToSign).digest('hex');
    expect(request.url).toBe(`https://examplebucket.s3.us-east-1.amazonaws.com${path}?${query}&X-Amz-Signature=${signature}`);
  });

  it('binds a copy to the entity tag of the checked source in a signed header, and answers a source changed since as a definite failure', async () => {
    const sent: Array<{ url: string; headers: Record<string, string> | undefined }> = [];
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async (url, init) => {
        sent.push({ url, headers: init.headers });
        return storageResponse(412, '<Error><Code>PreconditionFailed</Code></Error>');
      },
    });
    const copied = await storage.copyObject({ configuration: AWS, sourceKey: 'a', sourceEtag: '"3858f62230ac3c915f300c664312c11f"', key: 'b', deadlineMs: 1_000 });
    if (copied.ok) throw new Error('the copy was accepted');
    expect(storageFailureIsDefinite(copied.error)).toBe(true);
    const [request] = sent;
    expect(request?.headers?.['x-amz-copy-source-if-match']).toBe('"3858f62230ac3c915f300c664312c11f"');
    expect(new URL(request?.url ?? 'https://missing.test').searchParams.get('X-Amz-SignedHeaders')?.split(';')).toContain('x-amz-copy-source-if-match');
  });

  it.each([
    [404, '', 'not_found', true],
    [403, '<Error><Code>AccessDenied</Code></Error>', 'integration_unavailable', true],
    [500, '<Error><Code>InternalError</Code></Error>', 'integration_unavailable', false],
    [200, '<Error><Code>InternalError</Code></Error>', 'integration_unavailable', false],
    [200, '<?xml version="1.0" encoding="UTF-8"?>\n<Error xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Code>InternalError</Code></Error>', 'integration_unavailable', false],
    [200, '<s3:Error xmlns:s3="http://s3.amazonaws.com/doc/2006-03-01/"><Code>SlowDown</Code></s3:Error>', 'integration_unavailable', false],
    [200, '', 'integration_unavailable', false],
    [200, '<ListBucketResult></ListBucketResult>', 'integration_unavailable', false],
  ] as const)('reports a copy answered %s %j as %s, a definite failure: %s', async (status, body, code, definite) => {
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async () => storageResponse(status, body),
    });
    const copied = await storage.copyObject({ configuration: AWS, sourceKey: 'a', key: 'b', deadlineMs: 1_000 });
    if (copied.ok) throw new Error('the copy was accepted');
    expect(copied.error.code).toBe(code);
    expect(storageFailureIsDefinite(copied.error)).toBe(definite);
  });

  it.each([
    '<CopyObjectResult><ETag>"x"</ETag></CopyObjectResult>',
    '<?xml version="1.0" encoding="UTF-8"?>\n<CopyObjectResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><ETag>"x"</ETag></CopyObjectResult>',
    '<s3:CopyObjectResult xmlns:s3="http://s3.amazonaws.com/doc/2006-03-01/"><s3:ETag>"x"</s3:ETag></s3:CopyObjectResult>',
  ])('accepts a copy answered with the result %j', async (body) => {
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async () => storageResponse(200, body),
    });
    expect(await storage.copyObject({ configuration: AWS, sourceKey: 'a', key: 'b', deadlineMs: 1_000 })).toEqual({ ok: true, value: undefined });
  });

  it.each(['0', '12'])('reports an object of %s bytes against a ceiling of 9 as a definite digest failure', async (length) => {
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async () => storageResponse(200, '', { 'content-length': length }),
    });
    const digest = await storage.digestObject({ url: 'https://storage.example.test/bucket/file', accessKeyId: 'k', secretAccessKey: 's', region: 'us-east-1', deadlineMs: 1_000 }, { maxBytes: 9, headBytes: 4 });
    if (digest.ok) throw new Error('the digest was accepted');
    expect(storageFailureIsDefinite(digest.error)).toBe(true);
  });

  it('streams an object through SHA-256 and answers its size and first bytes without a buffer of the whole object', async () => {
    const chunks = [new Uint8Array([37, 80, 68, 70]), new Uint8Array([45, 49, 46, 55]), new Uint8Array([10])];
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async (_url, init) => {
        expect(init.headers?.['Accept-Encoding']).toBe('identity');
        let index = 0;
        return {
          ok: true, status: 200, headers: { get: (name) => name === 'content-length' ? '9' : null },
          body: { cancel: async () => undefined, getReader: () => ({
            read: async () => {
              const value = chunks[index];
              index += 1;
              return value === undefined ? { done: true } : { done: false, value };
            },
            cancel: async () => undefined, releaseLock: () => undefined,
          }) },
          text: async () => '',
        };
      },
    });
    const digest = await storage.digestObject({ url: 'https://storage.example.test/bucket/file', accessKeyId: 'k', secretAccessKey: 's', region: 'us-east-1', deadlineMs: 1_000 }, { maxBytes: 9, headBytes: 6 });
    const expected = createHash('sha256').update(Buffer.from([37, 80, 68, 70, 45, 49, 46, 55, 10])).digest('hex');
    expect(digest).toEqual({ ok: true, value: { sha256: expected, sizeBytes: 9, head: new Uint8Array([37, 80, 68, 70, 45, 49]) } });
    expect(await storage.digestObject({ url: 'https://storage.example.test/bucket/file', accessKeyId: 'k', secretAccessKey: 's', region: 'us-east-1', deadlineMs: 1_000 }, { maxBytes: 8, headBytes: 6 }))
      .toMatchObject({ ok: false });
  });

  it('gives up a HEAD, a delete, a copy and a digest whose storage never answers once the deadline passes', async () => {
    const pending = () => new Promise<never>(() => undefined);
    const storage = createS3StorageProvider(resolver, { lookupAddresses: async () => ['93.184.216.34'], fetchStorage: pending });
    const target = { url: 'https://storage.example.test/bucket/file', accessKeyId: 'k', secretAccessKey: 's', region: 'us-east-1', deadlineMs: 20 };
    const outcomes = await Promise.all([
      storage.head(target),
      storage.delete(target),
      storage.copyObject({ configuration: AWS, sourceKey: 'a', key: 'b', deadlineMs: 20 }),
      storage.digestObject(target, { maxBytes: 10, headBytes: 4 }),
    ]);
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({ ok: false, error: { code: 'integration_unavailable', message: expect.stringContaining('deadline passed') } });
      if (!outcome.ok) expect(storageFailureIsDefinite(outcome.error)).toBe(false);
    }
  });

  it('gives up a read and a write of a published image whose storage never answers once their deadline passes', async () => {
    const pending = () => new Promise<never>(() => undefined);
    const storage = createS3StorageProvider(resolver, { lookupAddresses: async () => ['93.184.216.34'], fetchStorage: pending });
    const target = { url: 'https://storage.example.test/bucket/file', accessKeyId: 'k', secretAccessKey: 's', region: 'us-east-1', deadlineMs: 20 };
    const outcomes = await Promise.all([
      storage.getObject(target, { maxBytes: 10 }),
      storage.putObject({ ...target, body: new Uint8Array([1]), contentType: 'image/png' }),
    ]);
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({ ok: false, error: { code: 'integration_unavailable', message: expect.stringContaining('deadline passed') } });
    }
  });

  it('gives up a read whose body stops arriving once its deadline passes', async () => {
    const { response } = streamedResponse(200, 'endless');
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async () => ({ ...response, headers: { get: (name: string) => name === 'content-length' ? '64' : null } }),
    });
    expect(await storage.getObject({ url: 'https://storage.example.test/bucket/file', accessKeyId: 'k', secretAccessKey: 's', region: 'us-east-1', deadlineMs: 20 }, { maxBytes: 64 }))
      .toMatchObject({ ok: false, error: { code: 'integration_unavailable', message: expect.stringContaining('deadline passed') } });
  });

  it('bounds a request that names a deadline by it, endpoint lookup included, and starts the default deadline once the endpoint resolved', async () => {
    vi.useFakeTimers();
    try {
      const storage = createS3StorageProvider(resolver, {
        lookupAddresses: () => new Promise((resolve) => { setTimeout(() => { resolve(['93.184.216.34']); }, 4_000); }),
        fetchStorage: async () => storageResponse(200, 'abc', { 'content-length': '3' }),
      });
      const target = { url: 'https://storage.example.test/bucket/file', accessKeyId: 'k', secretAccessKey: 's', region: 'us-east-1' };
      const bounded = { ...target, deadlineMs: 3_000 };
      const outcomes = Promise.all([
        storage.head(target),
        storage.delete(target),
        storage.head(bounded),
        storage.delete(bounded),
        storage.getObject(bounded, { maxBytes: 3 }),
        storage.putObject({ ...bounded, body: new Uint8Array([1]), contentType: 'image/png' }),
      ]);
      await vi.advanceTimersByTimeAsync(4_000);
      const [head, deleted, ...late] = await outcomes;
      expect(head).toEqual({ ok: true, value: { sizeBytes: 3 } });
      expect(deleted).toEqual({ ok: true, value: { deleted: true } });
      expect(late).toHaveLength(4);
      for (const outcome of late) {
        expect(outcome).toMatchObject({ ok: false, error: { code: 'integration_unavailable', message: expect.stringContaining('deadline passed') } });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers a refused write of a published image as definite and a server error as unknown', async () => {
    const answer = { status: 403 };
    const storage = createS3StorageProvider(resolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async () => storageResponse(answer.status, ''),
    });
    const write = { url: 'https://storage.example.test/bucket/file', accessKeyId: 'k', secretAccessKey: 's', region: 'us-east-1', body: new Uint8Array([1]), contentType: 'image/png' };
    const refused = await storage.putObject(write);
    answer.status = 503;
    const unknown = await storage.putObject(write);
    if (refused.ok || unknown.ok) throw new Error('A failed write answered ok');
    expect(storageFailureIsDefinite(refused.error)).toBe(true);
    expect(storageFailureIsDefinite(unknown.error)).toBe(false);
  });
});

describe('the signed download override probe', () => {
  it('signs a read with a type and a file name override and reports a provider that answers them', async () => {
    const bucket = fakeBucket();
    const storage = createS3StorageProvider(resolver, { fetchStorage: bucket.fetchStorage, allowPrivateEndpoints: true, probeKey: () => 'probe-id' });
    expect(await storage.probe(MINIO_CONFIGURATION)).toMatchObject({ ok: true, value: { signedResponseOverrides: 'honoured' } });
    const override = new URL(bucket.requests[2]?.url ?? 'http://missing.invalid');
    expect(override.searchParams.get('response-content-type')).toBe('application/x-together-probe');
    expect(override.searchParams.get('response-content-disposition')).toBe('attachment; filename="together-probe-override.txt"');
    expect(override.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/u);
    expect(bucket.objects.size).toBe(0);
  });

  it('reports a provider that returns the right body but ignores both overrides, without failing the configuration', async () => {
    const bucket = fakeBucket(undefined, undefined, { ignoresResponseOverrides: true });
    const storage = createS3StorageProvider(resolver, { fetchStorage: bucket.fetchStorage, allowPrivateEndpoints: true, probeKey: () => 'probe-id' });
    expect(await storage.probe(MINIO_CONFIGURATION)).toEqual({
      ok: true,
      value: {
        code: 'storage.available',
        message: expect.stringContaining('application/octet-stream download named after its stored object'),
        signedResponseOverrides: 'ignored',
      },
    });
    expect(bucket.requests.map((request) => request.method)).toEqual(['PUT', 'GET', 'GET', 'DELETE', 'OPTIONS']);
    expect(bucket.objects.size).toBe(0);
  });

  it('warns that buyer download links carry the overrides when a provider refuses a signed read that asks for them', async () => {
    const bucket = fakeBucket(undefined, undefined, { refusesResponseOverrides: true });
    const storage = createS3StorageProvider(resolver, { fetchStorage: bucket.fetchStorage, allowPrivateEndpoints: true, probeKey: () => 'probe-id' });
    expect(await storage.probe(MINIO_CONFIGURATION)).toEqual({
      ok: true,
      value: {
        code: 'storage.available',
        message: expect.stringMatching(/^Warning: .*Buyer download links carry these overrides/u),
        signedResponseOverrides: 'refused',
      },
    });
    expect(bucket.objects.size).toBe(0);
  });
});
