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
    2: {
      id: 'course-fixture-2',
      tenantId: 'tenant-fixture',
      name: 'Fixture Course',
      description: 'A representative course snapshot',
      imageUrl: 'https://cdn.example.com/course.png',
      moduleOrder: ['module-fixture-2', 'module-fixture-1'],
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
    3: {
      id: 'lesson-fixture-3',
      tenantId: 'tenant-fixture',
      name: 'Welcome lesson',
      contents: [
        { type: 'video', storageKey: 'videos/welcome', streamVideoId: 'stream-1' },
        { type: 'embed', embedUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        { type: 'embed', embedUrl: 'https://vimeo.com/channels/staffpicks/76979871' },
        { type: 'embed', embedUrl: 'https://www.youtube.com/live/jfKfPfyJRdk' },
        { type: 'embed', embedUrl: 'https://vimeo.com/groups/motion/videos/76979871' },
        { type: 'embed', embedUrl: 'https://vimeo.com/76979871?h=abc123' },
        { type: 'embed', embedUrl: 'https://www.youtube.com/embed/videoseries?list=PLabc' },
        { type: 'pdf', pdfUrl: '/assets/sample-lekcja.pdf', name: 'Cheatsheet' },
        { type: 'html', html: '<p>Hello</p>' },
      ],
      durationMinutes: 12,
      legacyId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    4: {
      id: 'lesson-fixture-4',
      tenantId: 'tenant-fixture',
      name: 'Provider video lesson',
      contents: [
        { type: 'embed', embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' },
        { type: 'embed', embedUrl: 'https://player.vimeo.com/video/76979871?h=5e2d1c1e6d' },
        { type: 'html', html: '<p>Hello</p>' },
      ],
      durationMinutes: 12,
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
    2: {
      id: 'product-fixture-2',
      tenantId: 'tenant-fixture',
      title: 'Full access with checkout consent',
      description: 'A representative product snapshot',
      priceCents: 9900,
      currency: 'PLN',
      published: true,
      accessItems: [{ level: 'course', courseId: 'course-fixture-1' }],
      checkoutConsentDefinitionIds: ['definition-news'],
      legacyId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    3: {
      id: 'product-fixture-3',
      tenantId: 'tenant-fixture',
      type: 'membership',
      slug: 'creator-club',
      title: 'Creator club',
      description: '<p>A representative product snapshot</p>',
      coverUrl: 'https://cdn.example.test/creator-club.jpg',
      priceCents: 9900,
      currency: 'PLN',
      published: true,
      accessItems: [{ level: 'course', courseId: 'course-fixture-1' }],
      checkoutConsentDefinitionIds: ['definition-news'],
      legacyId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  },
};
