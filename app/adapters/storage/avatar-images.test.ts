import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { ok, type StorageConfiguration } from '#core/domain/index.js';
import type { StorageProvider } from '#core/server/index.js';

import { createAvatarImageProcessor, isGoogleProfileImageUrl } from './avatar-images.js';

const configuration: StorageConfiguration = {
  provider: 'minio',
  endpoint: 'https://storage.example.test',
  region: 'eu-central-1',
  bucket: 'private-assets',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
};

const storage: StorageProvider = {
  putObject: async () => ok(undefined),
  list: async () => ok({ objects: [], continuationToken: null }),
  getObject: async () => ok(new Uint8Array()),
  objectUrl: (input, key) => new URL(`${input.endpoint}/${input.bucket}/${key}`),
  probe: async () => ok({ code: 'storage.available', message: 'ok' }),
  probeCors: async () => [],
  presignPut: (input) => ok(`${input.url}?signed=put`),
  presignGet: (input) => ok(`${input.url}?signed=get`),
  delete: async () => ok({ deleted: true }),
  head: async () => ok({ sizeBytes: 1 }),
  healthcheck: async () => ok({ healthy: true }),
  test: async () => ok({ code: 'storage.available', message: 'ok' }),
};

describe('avatar image processor', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('reads bounded %s bytes and publishes a 256px WebP at a distinct key', async (format) => {
    const source = await sharp({
      create: { width: 640, height: 320, channels: 3, background: '#336699' },
    }).toFormat(format).toBuffer();
    let stored: Uint8Array | null = null;
    const processor = createAvatarImageProcessor({
      ...storage,
      getObject: async (input, options) => {
        expect(input.url).toContain('/image-asset-candidates/');
        expect(options).toEqual({ maxBytes: 2 * 1024 * 1024, range: true });
        return ok(source);
      },
      putObject: async (input) => {
        expect(input.url).toContain('/image-assets/tenant-1/avatar/target.webp');
        expect(input.contentType).toBe('image/webp');
        stored = new Uint8Array(input.body);
        return ok(undefined);
      },
    });
    await expect(processor.processStored({
      configuration,
      sourceKey: `image-asset-candidates/tenant-1/avatar/source.${format === 'jpeg' ? 'jpg' : format}`,
      targetKey: 'image-assets/tenant-1/avatar/target.webp',
    })).resolves.toEqual(ok(undefined));
    expect(stored).not.toBeNull();
    const metadata = await sharp(stored ?? new Uint8Array()).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 256, height: 256 });
  });

  it.each(['png', 'jpg', 'webp'])('rejects SVG bytes declared as %s before publication', async (extension) => {
    const writes: string[] = [];
    const processor = createAvatarImageProcessor({
      ...storage,
      getObject: async () => ok(new TextEncoder().encode('<svg><script/></svg>')),
      putObject: async ({ url }) => { writes.push(url); return ok(undefined); },
    });
    expect(await processor.processStored({
      configuration,
      sourceKey: `image-asset-candidates/tenant-1/avatar/source.${extension}`,
      targetKey: 'image-assets/tenant-1/avatar/target.webp',
    })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(writes).toEqual([]);
  });

  it('retains remote Google avatar conversion', async () => {
    const source = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#336699' },
    }).png().toBuffer();
    const writes: Uint8Array[] = [];
    const processor = createAvatarImageProcessor({
      ...storage,
      putObject: async ({ body }) => { writes.push(body); return ok(undefined); },
    }, async () => new Response(new Uint8Array(source), { headers: { 'content-type': 'image/png' } }));
    expect(await processor.importRemote({
      configuration,
      sourceUrl: 'https://lh3.googleusercontent.com/a/photo',
      targetKey: 'image-assets/tenant-1/avatar/target.webp',
    })).toEqual(ok(undefined));
    expect(await sharp(writes[0]).metadata()).toMatchObject({ format: 'webp', width: 256, height: 256 });
  });

  it('accepts only HTTPS Google-hosted profile sources', () => {
    expect(isGoogleProfileImageUrl('https://lh3.googleusercontent.com/a/photo')).toBe(true);
    expect(isGoogleProfileImageUrl('https://courses.example.org/avatar.png')).toBe(false);
    expect(isGoogleProfileImageUrl('http://lh3.googleusercontent.com/a/photo')).toBe(false);
  });
});
