import { describe, expect, it } from 'vitest';

import { buildVersionPreview, changedPreviewFields } from './version-preview.js';
import { readSnapshot } from './versioning.js';

const createdAt = '2026-01-01T00:00:00.000Z';

const course = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  tenantId: 't1',
  name: 'Course',
  description: 'Body',
  imageUrl: null,
  moduleOrder: ['m1'],
  publiclyVisible: false,
  legacyId: null,
  createdAt,
  ...over,
});

const lesson = (contents: unknown[]) => ({
  id: 'l1',
  tenantId: 't1',
  name: 'Lesson',
  isPreview: false,
  contents,
  legacyId: null,
  createdAt,
});

const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  tenantId: 't1',
  type: 'course',
  slug: 'a-product',
  title: 'A product',
  description: 'Copy',
  coverUrl: null,
  priceCents: 9_900,
  currency: 'PLN',
  visibility: 'listed',
  published: false,
  accessItems: [],
  legacyId: null,
  createdAt,
  ...over,
});

const moduleNames = new Map([['m1', 'Foundations']]);

describe('version previews', () => {
  it('renders a course as its edit-form fields with resolved module names', () => {
    const preview = buildVersionPreview('course', course({ imageUrl: '/covers/a.png' }), moduleNames);

    expect(preview.ok && preview.value.fields).toEqual([
      { name: 'title', value: { kind: 'text', value: 'Course' } },
      { name: 'description', value: { kind: 'text', value: 'Body' } },
      { name: 'imageUrl', value: { kind: 'image', url: '/covers/a.png' } },
      { name: 'salesUrl', value: { kind: 'text', value: '' } },
      { name: 'publiclyVisible', value: { kind: 'flag', value: false } },
      { name: 'modules', value: { kind: 'list', items: ['Foundations'] } },
    ]);
  });

  it('falls back to the module id when the module is gone', () => {
    const preview = buildVersionPreview('course', course({ moduleOrder: ['m9'] }), moduleNames);

    expect(preview.ok && preview.value.fields.at(-1)).toEqual({
      name: 'modules',
      value: { kind: 'list', items: ['m9'] },
    });
  });

  it('summarizes lesson blocks by type and detail', () => {
    const preview = buildVersionPreview(
      'course_lesson',
      lesson([
        { type: 'video', storageKey: 'k', streamVideoId: 'vid-1' },
        { type: 'embed', embedUrl: 'https://www.youtube-nocookie.com/embed/abcdefghijk' },
        { type: 'pdf', pdfUrl: '/files/a.pdf', name: 'Slides' },
        { type: 'link', url: 'https://example.test/', description: 'Docs' },
        { type: 'html', html: '<p>Hi</p>' },
      ]),
      new Map(),
    );

    expect(preview.ok && preview.value.fields.at(-1)).toEqual({
      name: 'blocks',
      value: {
        kind: 'blocks',
        items: [
          { type: 'video', detail: 'vid-1' },
          { type: 'embed', detail: 'https://www.youtube-nocookie.com/embed/abcdefghijk' },
          { type: 'pdf', detail: 'Slides' },
          { type: 'link', detail: 'Docs' },
          { type: 'html', detail: '' },
        ],
      },
    });
  });

  it('lists module chapters as chapter/content pairs', () => {
    const preview = buildVersionPreview(
      'course_module',
      {
        id: 'm1',
        tenantId: 't1',
        courseIds: ['c1'],
        title: 'Foundations',
        prefix: null,
        name: 'Foundations',
        chapters: [
          { id: 'ch1', name: 'Intro', contents: [{ id: 'c1', name: 'Welcome', lessonId: 'l1' }] },
          { id: 'ch2', name: 'Empty', contents: [] },
        ],
        legacyId: null,
        createdAt,
      },
      new Map(),
    );

    expect(preview.ok && preview.value.fields.at(-1)).toEqual({
      name: 'chapters',
      value: { kind: 'list', items: ['Intro / Welcome', 'Empty'] },
    });
  });

  it('renders a product as name, price, description and its ordered gallery', () => {
    const preview = buildVersionPreview(
      'product',
      product({ images: [{ url: '/api/public/assets/product-image/back.png', alt: '' }, { url: '/api/public/assets/product-image/front.png', alt: 'Front' }] }),
      new Map(),
    );

    expect(preview.ok && preview.value.fields).toEqual([
      { name: 'title', value: { kind: 'text', value: 'A product' } },
      { name: 'price', value: { kind: 'price', amountCents: 9_900, currency: 'PLN' } },
      { name: 'description', value: { kind: 'text', value: 'Copy' } },
      { name: 'images', value: { kind: 'list', items: ['/api/public/assets/product-image/back.png', '/api/public/assets/product-image/front.png · Front'] } },
    ]);
  });

  it('lists the gallery as changed when a version saved before galleries meets a product with images', () => {
    const upcast = readSnapshot('product', { schemaVersion: 11, payload: product() });
    if (!upcast.ok) throw new Error(upcast.error.message);
    const stored = buildVersionPreview('product', upcast.value.payload, new Map());
    const current = buildVersionPreview('product', product({ images: [{ url: '/api/public/assets/product-image/front.png', alt: 'Front' }] }), new Map());
    const reordered = buildVersionPreview('product', product({
      images: [{ url: '/api/public/assets/product-image/b.png', alt: '' }, { url: '/api/public/assets/product-image/a.png', alt: '' }],
    }), new Map());
    const original = buildVersionPreview('product', product({
      images: [{ url: '/api/public/assets/product-image/a.png', alt: '' }, { url: '/api/public/assets/product-image/b.png', alt: '' }],
    }), new Map());
    if (!stored.ok || !current.ok || !reordered.ok || !original.ok) throw new Error('Expected all previews');

    expect(changedPreviewFields(stored.value, current.value)).toEqual(['images']);
    expect(changedPreviewFields(original.value, reordered.value)).toEqual(['images']);
  });

  it('rejects a payload that does not match the current schema', () => {
    expect(buildVersionPreview('course', { id: 'c1' }, new Map())).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
  });

  it('reports only the fields that differ', () => {
    const before = buildVersionPreview('course', course(), moduleNames);
    const after = buildVersionPreview(
      'course',
      course({ name: 'Renamed', publiclyVisible: true }),
      moduleNames,
    );
    if (!before.ok || !after.ok) throw new Error('Expected both previews');

    expect(changedPreviewFields(before.value, after.value)).toEqual(['title', 'publiclyVisible']);
  });
});
