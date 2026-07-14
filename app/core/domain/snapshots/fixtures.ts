import type { EntityKind } from '../versioning.js';

/**
 * One representative payload PER historical schemaVersion PER kind. The
 * enforcement test asserts each fixture upcasts through the chain and parses
 * with the current schema, and that the CURRENT version always has a fixture.
 * Adding a version bump without adding its fixture here fails the gate.
 */
export const SNAPSHOT_FIXTURES: Record<EntityKind, Record<number, unknown>> = {
  course: {
    1: {
      id: 'course-fixture-1',
      tenantId: 'tenant-fixture',
      name: 'Fixture Course',
      description: 'A representative course snapshot',
      imageUrl: 'https://cdn.example.com/course.png',
      legacyId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  },
  course_module: {
    1: {
      id: 'module-fixture-1',
      tenantId: 'tenant-fixture',
      courseIds: ['course-fixture-1'],
      title: 'Fundamentals',
      prefix: '01',
      name: '01 - Fundamentals',
      chapters: [
        {
          id: 'chapter-fixture-1',
          name: 'Getting started',
          contents: [{ id: 'content-fixture-1', name: 'Welcome', lessonId: 'lesson-fixture-1' }],
        },
      ],
      legacyId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  },
  course_lesson: {
    1: {
      id: 'lesson-fixture-1',
      tenantId: 'tenant-fixture',
      name: 'Welcome lesson',
      contents: [
        { type: 'video', storageKey: 'videos/welcome', streamVideoId: 'stream-1' },
        { type: 'pdf', pdfUrl: 'https://cdn.example.com/cheatsheet.pdf', name: 'Cheatsheet' },
        { type: 'html', html: '<p>Hello</p>' },
      ],
      legacyId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    2: {
      id: 'lesson-fixture-2',
      tenantId: 'tenant-fixture',
      name: 'Welcome lesson',
      contents: [
        { type: 'video', storageKey: 'videos/welcome', streamVideoId: 'stream-1' },
        { type: 'pdf', pdfUrl: '/assets/sample-lekcja.pdf', name: 'Cheatsheet' },
        { type: 'html', html: '<p>Hello</p>' },
      ],
      legacyId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  },
  product: {
    1: {
      id: 'product-fixture-1',
      tenantId: 'tenant-fixture',
      title: 'Full access',
      description: 'A representative product snapshot',
      priceCents: 9900,
      currency: 'PLN',
      published: true,
      accessItems: [{ level: 'course', courseId: 'course-fixture-1' }],
      legacyId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  },
};
