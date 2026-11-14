import { describe, expect, it } from 'vitest';

import {
  importRecordSchema,
  importRecordSchemaFor,
  importValidateRequestSchema,
  importWriteRequestSchema,
  type ImportKind,
} from './import.js';
import { lessonBlockSchema, newCourseSchema, newCourseLessonSchema, newCourseModuleSchema } from './course.js';
import { productComplianceSchema } from './product-compliance.js';

const records: Record<ImportKind, Record<string, unknown>> = {
  course: { importKey: 'course', name: 'Course', description: '', imageUrl: null, moduleOrder: [] },
  module: { importKey: 'module', courseKeys: [], title: 'Module', prefix: null, chapters: [] },
  lesson: { importKey: 'lesson', name: 'Lesson', isPreview: false, contents: [] },
  product: { importKey: 'product', type: 'physical', slug: 'product', title: 'Product', description: '', coverUrl: null, priceCents: 0, currency: 'USD', accessItems: [] },
  member: { importKey: 'member', email: 'member@example.test', displayName: 'Member' },
  grant: { importKey: 'grant', memberKey: 'member', productKey: 'product', startsAt: '1998-01-01T00:00:00Z', expiresAt: null },
  progress: { importKey: 'progress', memberKey: 'member', courseKey: 'course', completedLessonKeys: [], updatedAt: '1998-01-01T00:00:00Z' },
  redirect: { importKey: 'redirect', fromPath: '/old', target: { kind: 'path', path: '/new' }, permanent: true },
};

const compliance = {
  manufacturerName: 'Maker', manufacturerAddress: 'Street 1', manufacturerEmail: 'maker@example.test',
  modelIdentifier: 'model', safetyWarnings: '',
};
const chapter = { id: 'chapter', name: 'Chapter', contents: [] };
const content = { id: 'content', name: 'Content', lessonKey: 'lesson' };
const video = { type: 'video', storageKey: 'key', streamVideoId: 'video' };
const url = (length: number): string => `https://example.test/${'a'.repeat(length - 21)}`;
const email = (length: number): string => `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(length - 197)}.com`;

type LimitCase = {
  label: string;
  kind: ImportKind;
  max: number;
  payload: (value: string) => object;
  value?: (length: number) => string;
};
const field = (kind: ImportKind, key: string, max: number, value?: (length: number) => string): LimitCase => ({
  label: `${kind}.${key}`, kind, max,
  payload: (text) => ({ ...records[kind], [key]: text }),
  ...(value === undefined ? {} : { value }),
});
const lessonBlockField = (label: string, block: object, key: string, max: number, value?: (length: number) => string): LimitCase => ({
  label: `lesson.contents.${label}`, kind: 'lesson', max,
  payload: (text) => ({ ...records.lesson, contents: [{ ...block, [key]: text }] }),
  ...(value === undefined ? {} : { value }),
});
const referenceField = (kind: ImportKind, key: string, array = false): LimitCase => ({
  label: `${kind}.${key}`, kind, max: 200,
  payload: (text) => ({ ...records[kind], [key]: array ? [text] : text }),
});

const limits: LimitCase[] = [
  ...(['course', 'module', 'lesson', 'product', 'member', 'grant', 'progress', 'redirect'] as const)
    .map((kind) => field(kind, 'importKey', 200)),
  ...(['course', 'module', 'lesson', 'product', 'member', 'grant', 'redirect'] as const)
    .map((kind) => field(kind, 'legacyId', 200)),
  field('course', 'name', 500), field('course', 'description', 50_000), field('course', 'imageUrl', 2_048, url),
  referenceField('course', 'moduleOrder', true),
  field('module', 'title', 500), field('module', 'prefix', 500), referenceField('module', 'courseKeys', true),
  ...(['id', 'name'] as const).map((key): LimitCase => ({
    label: `module.chapters.${key}`, kind: 'module', max: key === 'id' ? 200 : 500,
    payload: (text) => ({ ...records.module, chapters: [{ ...chapter, [key]: text }] }),
  })),
  ...(['id', 'name', 'lessonKey'] as const).map((key): LimitCase => ({
    label: `module.chapters.contents.${key}`, kind: 'module', max: key === 'name' ? 500 : 200,
    payload: (text) => ({ ...records.module, chapters: [{ ...chapter, contents: [{ ...content, [key]: text }] }] }),
  })),
  field('lesson', 'name', 500),
  lessonBlockField('video.storageKey', video, 'storageKey', 1_024),
  ...(['streamVideoId', 'streamLibraryId', 'streamCollectionId'] as const)
    .map((key) => lessonBlockField(`video.${key}`, video, key, 200)),
  lessonBlockField('embed.embedUrl', { type: 'embed' }, 'embedUrl', 2_048, url),
  lessonBlockField('pdf.pdfUrl', { type: 'pdf' }, 'pdfUrl', 2_048, url),
  lessonBlockField('pdf.name', { type: 'pdf', pdfUrl: '/document.pdf' }, 'name', 2_000),
  lessonBlockField('link.url', { type: 'link' }, 'url', 2_048, url),
  lessonBlockField('link.description', { type: 'link', url: 'https://example.test/' }, 'description', 2_000),
  lessonBlockField('html.html', { type: 'html' }, 'html', 1_000_000),
  ...(['number', 'note'] as const).map((key): LimitCase => ({
    label: `lesson.edition.${key}`, kind: 'lesson', max: key === 'number' ? 12 : 200,
    payload: (text) => ({ ...records.lesson, edition: { number: '1', [key]: text } }),
    ...(key === 'number' ? { value: (length: number) => '1'.repeat(length) } : {}),
  })),
  field('product', 'title', 200), field('product', 'slug', 100), field('product', 'description', 50_000),
  field('product', 'coverUrl', 2_048, url), field('product', 'vatExemptionBasis', 256),
  field('product', 'variantGroup', 60), field('product', 'variantLabel', 60),
  ...([
    ['manufacturerName', 200], ['manufacturerAddress', 300], ['manufacturerEmail', 254],
    ['modelIdentifier', 100], ['batchIdentifier', 100], ['safetyWarnings', 5_000], ['instructionsUrl', 2_048],
  ] as const).map(([key, max]): LimitCase => ({
    label: `product.compliance.${key}`, kind: 'product', max,
    payload: (text) => ({ ...records.product, compliance: { ...compliance, [key]: text } }),
    ...(key === 'instructionsUrl' ? { value: url } : key === 'manufacturerEmail' ? { value: email } : {}),
  })),
  ...(['course', 'modules', 'lessons'] as const).flatMap((level) => {
    const base = { level, courseKey: 'course', ...(level === 'modules' ? { moduleKeys: ['module'] } : level === 'lessons' ? { lessonKeys: ['lesson'] } : {}) };
    const keys = level === 'course' ? ['courseKey', 'excludedModuleKeys'] : level === 'modules' ? ['courseKey', 'moduleKeys'] : ['courseKey', 'lessonKeys'];
    return keys.map((key): LimitCase => ({
      label: `product.accessItems.${level}.${key}`, kind: 'product', max: 200,
      payload: (text) => ({ ...records.product, accessItems: [{ ...base, [key]: key === 'courseKey' ? text : [text] }] }),
    }));
  }),
  field('member', 'email', 254, email), field('member', 'displayName', 200),
  referenceField('grant', 'memberKey'), referenceField('grant', 'productKey'),
  referenceField('progress', 'memberKey'), referenceField('progress', 'courseKey'),
  referenceField('progress', 'completedLessonKeys', true), referenceField('progress', 'lastViewedLessonKey'),
  referenceField('progress', 'lastViewedModuleKey'), field('progress', 'lastViewedChapterId', 200),
  field('redirect', 'fromPath', 2_000, (length) => `/${'a'.repeat(length - 1)}`),
  ...(['course', 'module-as-course', 'lesson', 'path'] as const).flatMap((kind) => {
    const keys = kind === 'lesson' ? ['importKey', 'courseKey'] : kind === 'path' ? ['path'] : ['importKey'];
    return keys.map((key): LimitCase => ({
      label: `redirect.target.${kind}.${key}`, kind: 'redirect', max: key === 'path' ? 2_000 : 200,
      payload: (text) => ({ ...records.redirect, target: { kind, ...(kind === 'lesson' ? { importKey: 'lesson', courseKey: 'course' } : {}), [key]: text } }),
      ...(key === 'path' ? { value: (length: number) => `/${'a'.repeat(length - 1)}` } : {}),
    }));
  }),
];

describe('import-only input field limits', () => {
  it.each(limits)('accepts max and rejects max+1 for $label through both record schemas', ({ kind, max, payload, value }) => {
    const text = value ?? ((length: number) => 'a'.repeat(length));
    for (const length of [max, max + 1]) {
      const record = payload(text(length));
      expect(importRecordSchemaFor(kind).safeParse(record).success, `${kind}: ${length}`).toBe(length === max);
      expect(importRecordSchema.safeParse({ kind, ...record }).success, `${kind}: ${length}`).toBe(length === max);
    }
  });

  it('checks embed length before video URL normalization can shorten the input', () => {
    const embedUrl = `https://www.youtube.com/watch?v=dQw4w9WgXcQ&extra=${'x'.repeat(2_048)}`;
    expect(importRecordSchemaFor('lesson').safeParse({ ...records.lesson, contents: [{ type: 'embed', embedUrl }] }).success).toBe(false);
    expect(lessonBlockSchema.safeParse({ type: 'embed', embedUrl }).success).toBe(true);
  });

  it('preserves native writes and stored block/compliance readers', () => {
    expect(newCourseSchema.safeParse({ name: 'a'.repeat(501) }).success).toBe(true);
    expect(newCourseModuleSchema.safeParse({ title: 'a'.repeat(501), prefix: 'a'.repeat(501) }).success).toBe(true);
    expect(newCourseLessonSchema.safeParse({ name: 'a'.repeat(501), contents: [{ type: 'html', html: 'x'.repeat(1_000_001) }] }).success).toBe(true);
    expect(lessonBlockSchema.safeParse({ ...video, storageKey: 'a'.repeat(1_025) }).success).toBe(true);
    expect(productComplianceSchema.safeParse({ ...compliance, instructionsUrl: url(2_049) }).success).toBe(true);
  });

  it('retains write and validate envelope boundaries independently of record validity', () => {
    const request = (count: number) => ({ datasetVersion: 'together-import/v1', records: Array.from({ length: count }, () => null) });
    expect(importWriteRequestSchema.safeParse(request(200)).success).toBe(true);
    expect(importWriteRequestSchema.safeParse(request(201)).success).toBe(false);
    expect(importValidateRequestSchema.safeParse(request(5_000)).success).toBe(true);
    expect(importValidateRequestSchema.safeParse(request(5_001)).success).toBe(false);
  });
});
