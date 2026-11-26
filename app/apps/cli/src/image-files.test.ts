import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { imageUploadInput, parseProductImagesJson, productImagesFileOption } from './image-files.js';

const galleryUrl = '/api/public/assets/product-image/00000000-0000-4000-8000-000000000001.webp';

describe('product images file option', () => {
  let directory = '';
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'together-cli-images-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('sends no gallery when the option is absent', async () => {
    expect(await productImagesFileOption(undefined)).toEqual({ ok: true, value: {} });
  });

  it('reads the ordered gallery with trimmed and defaulted alt texts', async () => {
    const file = join(directory, 'images.json');
    await writeFile(file, JSON.stringify([{ url: 'https://cdn.example.test/side.jpg', alt: ' Side ' }, { url: galleryUrl }]));
    expect(await productImagesFileOption(file)).toEqual({
      ok: true,
      value: { images: [{ url: 'https://cdn.example.test/side.jpg', alt: 'Side' }, { url: galleryUrl, alt: '' }] },
    });
  });

  it('passes an empty list through so the gallery is cleared', () => {
    expect(parseProductImagesJson('[]')).toEqual({ ok: true, value: [] });
  });

  it('refuses unreadable files, invalid JSON, unknown fields and duplicate URLs', async () => {
    expect(await productImagesFileOption(join(directory, 'missing.json'))).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(parseProductImagesJson('[{')).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(parseProductImagesJson(JSON.stringify([{ url: galleryUrl, caption: 'Front' }]))).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(parseProductImagesJson(JSON.stringify([{ url: galleryUrl }, { url: galleryUrl }]))).toMatchObject({ ok: false, error: { code: 'validation', message: 'Invalid product images' } });
  });
});

describe('image upload input', () => {
  it('describes a gallery image file for the upload request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'together-cli-image-'));
    try {
      const file = join(directory, 'front.WEBP');
      await writeFile(file, new Uint8Array([1, 2, 3]));
      expect(await imageUploadInput('product-image', file)).toMatchObject({
        ok: true,
        value: { kind: 'product-image', fileName: 'front.WEBP', contentType: 'image/webp', sizeBytes: 3 },
      });
      expect(await imageUploadInput('product-image', join(directory, 'front.gif'))).toMatchObject({ ok: false, error: { code: 'validation' } });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
