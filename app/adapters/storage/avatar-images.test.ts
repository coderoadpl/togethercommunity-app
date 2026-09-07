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
  it('fetches, center-crops, and stores a 256px WebP', async () => {
    const source = await sharp({
      create: { width: 640, height: 320, channels: 3, background: '#336699' },
    }).png().toBuffer();
    const sourceBody = new Uint8Array(new ArrayBuffer(source.byteLength));
    sourceBody.set(source);
    let stored: Uint8Array | null = null;
    const fetchImage: typeof fetch = async (_input, init) => {
      if (init?.method === 'PUT') {
        if (!(init.body instanceof Uint8Array)) throw new Error('Expected avatar bytes');
        stored = new Uint8Array(init.body);
        return new Response(null, { status: 200 });
      }
      return new Response(sourceBody, {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': String(source.byteLength) },
      });
    };
    const processor = createAvatarImageProcessor(storage, fetchImage);

    await expect(processor.processStored({
      configuration,
      sourceKey: 'image-assets/tenant-1/avatar/source.png',
      targetKey: 'image-assets/tenant-1/avatar/target.webp',
    })).resolves.toEqual(ok(undefined));

    expect(stored).not.toBeNull();
    const metadata = await sharp(stored ?? new Uint8Array()).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 256, height: 256 });
  });

  it('accepts only HTTPS Google-hosted profile sources', () => {
    expect(isGoogleProfileImageUrl('https://lh3.googleusercontent.com/a/photo')).toBe(true);
    expect(isGoogleProfileImageUrl('https://courses.example.org/avatar.png')).toBe(false);
    expect(isGoogleProfileImageUrl('http://lh3.googleusercontent.com/a/photo')).toBe(false);
  });
});
