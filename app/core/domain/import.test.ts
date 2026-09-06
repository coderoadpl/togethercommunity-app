import { describe, expect, it } from 'vitest';

import {
  importCourseRecordSchema,
  importLessonRecordSchema,
  importProductRecordSchema,
  importRecordSchemaFor,
} from './import.js';

const lessonRecord = (embed: Record<string, unknown>) => ({
  importKey: 'lesson-l1',
  legacyId: 'l1',
  name: 'Dialogs in JavaScript',
  isPreview: false,
  contents: [embed],
});

const collapsedEmbed = {
  type: 'embed',
  embedUrl: 'https://codesandbox.io/s/alert-demo-abc123',
  collapsed: true,
};

describe('lesson import records', () => {
  it('accepts an embed block marked as collapsed', () => {
    const parsed = importLessonRecordSchema.safeParse(lessonRecord(collapsedEmbed));

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.contents).toEqual([collapsedEmbed]);
  });

  it('accepts the collapsed flag through the m2m record schema for lessons', () => {
    expect(importRecordSchemaFor('lesson').safeParse(lessonRecord(collapsedEmbed)).success).toBe(true);
  });

  it('leaves collapsed absent when the record omits it', () => {
    const parsed = importLessonRecordSchema.safeParse(
      lessonRecord({ type: 'embed', embedUrl: 'https://codesandbox.io/s/alert-demo-abc123' }),
    );

    expect(parsed.success && parsed.data.contents).toEqual([
      { type: 'embed', embedUrl: 'https://codesandbox.io/s/alert-demo-abc123' },
    ]);
  });

  it('rejects a non-boolean collapsed value', () => {
    const parsed = importLessonRecordSchema.safeParse(
      lessonRecord({ ...collapsedEmbed, collapsed: 'true' }),
    );

    expect(parsed.success).toBe(false);
  });
});

describe('import asset URL fields', () => {
  const courseAssetPath = '/api/public/assets/course-cover/00000000-0000-4000-8000-000000000001.jpg';
  const productAssetPath = '/api/public/assets/product-cover/00000000-0000-4000-8000-000000000002.webp';

  it('accepts host-relative public asset paths for course and product covers', () => {
    expect(importCourseRecordSchema.safeParse({
      importKey: 'course-l1',
      name: 'Course',
      description: '',
      imageUrl: courseAssetPath,
      moduleOrder: [],
    }).success).toBe(true);
    expect(importProductRecordSchema.safeParse({
      importKey: 'product-l1',
      type: 'course',
      slug: 'course',
      title: 'Course',
      description: '',
      coverUrl: productAssetPath,
      priceCents: 0,
      currency: 'PLN',
      accessItems: [],
    }).success).toBe(true);
  });

  it('rejects relative cover paths outside the public asset route', () => {
    expect(importCourseRecordSchema.safeParse({
      importKey: 'course-l1',
      name: 'Course',
      description: '',
      imageUrl: '/covers/course.jpg',
      moduleOrder: [],
    }).success).toBe(false);
    expect(importProductRecordSchema.safeParse({
      importKey: 'product-l1',
      type: 'course',
      slug: 'course',
      title: 'Course',
      description: '',
      coverUrl: '/covers/product.jpg',
      priceCents: 0,
      currency: 'PLN',
      accessItems: [],
    }).success).toBe(false);
  });

  it('accepts the same asset path through the m2m record schema', () => {
    expect(importRecordSchemaFor('course').safeParse({
      importKey: 'course-l1',
      name: 'Course',
      description: '',
      imageUrl: courseAssetPath,
      moduleOrder: [],
    }).success).toBe(true);
  });
});
