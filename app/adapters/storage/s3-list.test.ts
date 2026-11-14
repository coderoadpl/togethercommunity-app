import { describe, expect, it, vi } from 'vitest';

import { ok, type StorageConfiguration } from '#core/domain/index.js';

import { parseListObjectsPage } from './list-objects.js';
import { createS3StorageProvider } from './s3.js';

const configuration: StorageConfiguration = {
  provider: 'minio', endpoint: 'http://127.0.0.1:19000', bucket: 'test-bucket', region: 'us-east-1',
  accessKeyId: 'test-access', secretAccessKey: 'test-secret',
};
const prefix = 'tenant-a/lesson-attachments/';
const key = `${prefix}lesson/asset/a + b & %2F.pdf`;
const listing = (contents = `<Contents><Key>${encodeURIComponent(key)}</Key><Size>123</Size><LastModified>2026-11-08T12:00:00.000Z</LastModified></Contents>`, truncated = false) =>
  `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><EncodingType>url</EncodingType><KeyCount>${contents === '' ? '0' : '1'}</KeyCount><IsTruncated>${String(truncated)}</IsTruncated>${contents}${truncated ? '<NextContinuationToken>next+/=&amp;cursor</NextContinuationToken>' : ''}</ListBucketResult>`;

const fixture = (body: string, status = 200) => {
  const cancel = vi.fn(async () => undefined);
  const releaseLock = vi.fn();
  const response = {
    ok: status === 200, status,
    headers: { get: () => null },
    text: async () => body,
    body: {
      cancel,
      getReader: () => {
        let delivered = false;
        return {
          read: async () => {
            if (delivered) return { done: true };
            delivered = true;
            return { done: false, value: new TextEncoder().encode(body) };
          },
          cancel,
          releaseLock,
        };
      },
    },
  };
  const fetchStorage = vi.fn<(url: string, init: { method: string }) => Promise<typeof response>>(async () => response);
  const storage = createS3StorageProvider({ resolve: async () => ok('{}') }, { fetchStorage, allowPrivateEndpoints: true });
  return { storage, fetchStorage, cancel, releaseLock };
};

describe('S3 paginated object listing', () => {
  it('signs ListObjectsV2 with a prefix and cursor and parses encoded keys exactly once', async () => {
    const { storage, fetchStorage, releaseLock } = fixture(listing(undefined, true));
    expect(await storage.list({ configuration, prefix, continuationToken: 'previous+/=&cursor', limit: 50 })).toEqual(ok({
      objects: [{ key, sizeBytes: 123, lastModified: '2026-11-08T12:00:00.000Z' }],
      continuationToken: 'next+/=&cursor',
    }));
    const call = fetchStorage.mock.calls[0];
    expect(call?.[1].method).toBe('GET');
    const url = new URL(call?.[0] ?? 'http://invalid');
    expect(url.pathname).toBe('/test-bucket/');
    expect(url.searchParams.get('list-type')).toBe('2');
    expect(url.searchParams.get('encoding-type')).toBe('url');
    expect(url.searchParams.get('prefix')).toBe(prefix);
    expect(url.searchParams.get('continuation-token')).toBe('previous+/=&cursor');
    expect(url.searchParams.get('max-keys')).toBe('50');
    expect(url.searchParams.has('X-Amz-Signature')).toBe(true);
    expect(releaseLock).toHaveBeenCalledOnce();
  });

  it('supports an empty terminal page', async () => {
    const { storage } = fixture(listing(''));
    expect(await storage.list({ configuration, prefix, continuationToken: null, limit: 1000 })).toEqual(ok({
      objects: [], continuationToken: null,
    }));
  });

  it('rejects malformed XML, invalid metadata, and missing cursors', () => {
    for (const body of [
      '<broken>',
      listing().replace('<Size>123</Size>', '<Size>-1</Size>'),
      listing().replace('2026-11-08T12:00:00.000Z', 'yesterday'),
      listing().replace('<EncodingType>url</EncodingType>', ''),
      listing().replace('<KeyCount>1</KeyCount>', '<KeyCount>2</KeyCount>'),
      listing().replace('<IsTruncated>false</IsTruncated>', '<IsTruncated>true</IsTruncated>'),
      listing().replace(encodeURIComponent(key), '%invalid'),
      '<!DOCTYPE external SYSTEM "https://example.test/external">' + listing(),
    ]) expect(parseListObjectsPage(body)).toMatchObject({ ok: false });
  });

  it('bounds response bytes and refuses objects outside the requested prefix', async () => {
    const oversized = fixture('x'.repeat(2 * 1024 * 1024 + 1));
    expect(await oversized.storage.list({ configuration, prefix, continuationToken: null, limit: 1 })).toMatchObject({ ok: false });
    expect(oversized.cancel).toHaveBeenCalledOnce();
    const outside = fixture(listing().replace(encodeURIComponent(key), encodeURIComponent('tenant-b/private.pdf')));
    expect(await outside.storage.list({ configuration, prefix, continuationToken: null, limit: 1 })).toMatchObject({ ok: false });
  });

  it('returns expected failures for invalid inputs and non-success responses', async () => {
    const { storage, fetchStorage, cancel } = fixture('', 403);
    expect(await storage.list({ configuration, prefix, continuationToken: null, limit: 0 })).toMatchObject({ ok: false });
    expect(fetchStorage).not.toHaveBeenCalled();
    expect(await storage.list({ configuration, prefix, continuationToken: null, limit: 1 })).toMatchObject({ ok: false });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
