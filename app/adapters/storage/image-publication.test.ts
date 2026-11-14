import { describe, expect, it } from 'vitest';

import { ok, type StorageConfiguration } from '#core/domain/index.js';
import { getPublicImageAssetUrl } from '#core/server/usecases/image-assets.js';

import { createS3StorageProvider } from './s3.js';

const configuration: StorageConfiguration = {
  provider: 'minio', endpoint: 'https://storage.example.test', bucket: 'private-assets',
  region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret',
};
const secretResolver = { resolve: async () => ok(JSON.stringify(configuration)) };
const id = '00000000-0000-4000-8000-000000000001';

describe('public image response signing', () => {
  it.each([
    ['logo', 'svg', 'image/svg+xml', 'attachment'],
    ['logo-dark', 'svg', 'image/svg+xml', 'attachment'],
    ['course-cover', 'svg', 'image/svg+xml', 'attachment'],
    ['product-cover', 'jpg', 'image/jpeg', 'inline'],
    ['favicon', 'ico', 'image/x-icon', 'inline'],
    ['share-image', 'png', 'image/png', 'inline'],
    ['avatar', 'webp', 'image/webp', 'inline'],
  ])('overrides hostile legacy object headers for %s.%s through the S3 signer', async (kind, extension, contentType, disposition) => {
    const objects = new Map<string, { contentType: string; contentDisposition: string }>();
    const key = `image-assets/tenant-1/${kind}/${id}.${extension}`;
    objects.set(`/private-assets/${key}`, { contentType: 'text/html', contentDisposition: 'inline; filename="attack.html"' });
    const storage = createS3StorageProvider(secretResolver, {
      now: () => new Date('2026-08-16T12:00:00.000Z'),
      fetchStorage: async () => { throw new Error('Signing must not fetch stored metadata'); },
    });
    const result = await getPublicImageAssetUrl('tenant-1', { kind, file: `${id}.${extension}` }, { storage, secretResolver });
    if (!result.ok) throw new Error('Expected a signed public URL');
    const signed = new URL(result.value);
    expect(objects.get(signed.pathname)).toEqual({ contentType: 'text/html', contentDisposition: 'inline; filename="attack.html"' });
    expect(signed.searchParams.get('response-content-type')).toBe(contentType);
    expect(signed.searchParams.get('response-content-disposition')).toBe(disposition);
    expect(signed.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/u);
    expect(signed.searchParams.get('X-Amz-Expires')).toBe('3600');
    const withoutOverrides = storage.presignGet({
      url: storage.objectUrl(configuration, key).toString(),
      accessKeyId: configuration.accessKeyId, secretAccessKey: configuration.secretAccessKey,
      region: configuration.region, expiresInSeconds: 3600,
    });
    if (!withoutOverrides.ok) throw new Error('Expected baseline signature');
    expect(signed.searchParams.get('X-Amz-Signature')).not.toBe(new URL(withoutOverrides.value).searchParams.get('X-Amz-Signature'));
  });
});
