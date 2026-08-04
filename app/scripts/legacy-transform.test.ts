import { pbkdf2 } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyPasswordWithLegacyFallback } from '#adapters/auth/legacy-password.js';

import {
  collectOrphanContentAnomalies,
  dedupeProgress,
  legacyAccessItemSchema,
  legacyChapterSchema,
  legacyProgressSchema,
  legacyUserSchema,
  transformAccessItems,
  transformChapters,
  transformLessonContents,
  transformUser,
  type AccessItemLookups,
  type PdfPointer,
  type VideoPointer,
} from './legacy-transform.js';

const emptyLookups: AccessItemLookups = {
  courseIdsByModuleId: new Map(),
  moduleIdsByLessonId: new Map(),
};

describe('collectOrphanContentAnomalies', () => {
  it('names modules and lessons that cannot be assigned to a tenant', () => {
    const anomalies = collectOrphanContentAnomalies({
      modules: [
        { id: 'm-mapped', title: 'Mapped module' },
        { id: 'm-orphan', title: 'Lost module' },
      ],
      lessons: [
        { id: 'l-mapped', title: 'Mapped lesson' },
        { id: 'l-unattached', title: 'Loose lesson' },
        { id: 'l-orphan-module', title: 'Lesson under lost module' },
      ],
      courseIdsByModuleId: new Map([
        ['m-mapped', new Set(['c-mapped'])],
        ['m-orphan', new Set(['c-unmapped'])],
      ]),
      moduleIdsByLessonId: new Map([
        ['l-mapped', new Set(['m-mapped'])],
        ['l-orphan-module', new Set(['m-orphan'])],
      ]),
      mappedCourseIds: new Set(['c-mapped']),
    });

    expect(anomalies).toEqual([
      {
        kind: 'module-without-tenant',
        subject: 'course-modules/m-orphan',
        detail: 'module "Lost module" belongs to no mapped course and was not exported',
      },
      {
        kind: 'lesson-without-tenant',
        subject: 'course-lessons/l-unattached',
        detail:
          'lesson "Loose lesson" is attached to no module belonging to a mapped course and was not exported',
      },
      {
        kind: 'lesson-without-tenant',
        subject: 'course-lessons/l-orphan-module',
        detail:
          'lesson "Lesson under lost module" is attached to no module belonging to a mapped course and was not exported',
      },
    ]);
  });
});

describe('transformAccessItems', () => {
  it('maps a course-level item and drops its module/lesson leftovers', () => {
    const { items, anomalies } = transformAccessItems(
      'a1',
      [
        {
          id: 'item1',
          courses: ['c1'],
          courseLevelAccess: true,
          courseModules: ['m1'],
          courseLessons: ['l1'],
        },
      ],
      emptyLookups,
    );
    expect(items).toEqual([{ level: 'course', courseId: 'c1' }]);
    expect(anomalies).toEqual([]);
  });

  it('maps a module-level item', () => {
    const { items, anomalies } = transformAccessItems(
      'a1',
      [
        {
          id: 'item1',
          courses: ['c1'],
          courseLevelAccess: false,
          courseModules: ['m1', 'm2'],
          courseModuleLevelAccess: true,
          courseLessons: [],
        },
      ],
      emptyLookups,
    );
    expect(items).toEqual([{ level: 'modules', courseId: 'c1', moduleIds: ['m1', 'm2'] }]);
    expect(anomalies).toEqual([]);
  });

  it('maps a lesson-level item', () => {
    const { items, anomalies } = transformAccessItems(
      'a1',
      [
        {
          id: 'item1',
          courses: ['c1'],
          courseLevelAccess: false,
          courseModules: [],
          courseLessons: ['l1'],
        },
      ],
      emptyLookups,
    );
    expect(items).toEqual([{ level: 'lessons', courseId: 'c1', lessonIds: ['l1'] }]);
    expect(anomalies).toEqual([]);
  });

  it('treats selector-only courseModules as lesson-level (free-preview shape)', () => {
    const { items, anomalies } = transformAccessItems(
      'a1',
      [
        {
          id: 'item1',
          courses: ['c1'],
          courseLevelAccess: false,
          courseModules: ['m1'],
          courseModuleLevelAccess: false,
          courseLessons: ['l1'],
        },
      ],
      emptyLookups,
    );
    expect(items).toEqual([{ level: 'lessons', courseId: 'c1', lessonIds: ['l1'] }]);
    expect(anomalies).toEqual([]);
  });

  it('drops a module-level item without modules as degenerate', () => {
    const { items, anomalies } = transformAccessItems(
      'a1',
      [
        {
          id: 'item1',
          courses: ['c1'],
          courseLevelAccess: false,
          courseModules: [],
          courseModuleLevelAccess: true,
          courseLessons: ['l1'],
        },
      ],
      emptyLookups,
    );
    expect(items).toEqual([]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.kind).toBe('degenerate-access-item');
  });

  it('drops a degenerate item that grants nothing', () => {
    const { items, anomalies } = transformAccessItems(
      'a1',
      [
        {
          id: 'item1',
          courses: ['c1'],
          courseLevelAccess: false,
          courseModules: [],
          courseLessons: [],
        },
      ],
      emptyLookups,
    );
    expect(items).toEqual([]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.kind).toBe('degenerate-access-item');
  });

  it('emits one course-level item per course on a multi-course item', () => {
    const { items } = transformAccessItems(
      'a1',
      [
        {
          id: 'item1',
          courses: ['c1', 'c2'],
          courseLevelAccess: true,
          courseModules: [],
          courseLessons: [],
        },
      ],
      emptyLookups,
    );
    expect(items).toEqual([
      { level: 'course', courseId: 'c1' },
      { level: 'course', courseId: 'c2' },
    ]);
  });

  it('partitions modules of a multi-course item by module membership', () => {
    const lookups: AccessItemLookups = {
      courseIdsByModuleId: new Map([
        ['m1', new Set(['c1'])],
        ['m2', new Set(['c2'])],
        ['m3', new Set(['c9'])],
      ]),
      moduleIdsByLessonId: new Map(),
    };
    const { items, anomalies } = transformAccessItems(
      'a1',
      [
        {
          id: 'item1',
          courses: ['c1', 'c2'],
          courseLevelAccess: false,
          courseModules: ['m1', 'm2', 'm3'],
          courseModuleLevelAccess: true,
          courseLessons: [],
        },
      ],
      lookups,
    );
    expect(items).toEqual([
      { level: 'modules', courseId: 'c1', moduleIds: ['m1'] },
      { level: 'modules', courseId: 'c2', moduleIds: ['m2'] },
    ]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.kind).toBe('module-outside-item-courses');
  });
});

describe('legacyAccessItemSchema', () => {
  it('tolerates missing optional arrays', () => {
    const parsed = legacyAccessItemSchema.parse({ courses: ['c1'], courseLevelAccess: true });
    expect(parsed.courseModules).toEqual([]);
    expect(parsed.courseLessons).toEqual([]);
  });
});

describe('transformUser', () => {
  const salt = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

  const legacyReferenceHash = (password: string): Promise<string> =>
    new Promise((resolve, reject) => {
      pbkdf2(password, salt, 25000, 512, 'sha256', (error, derived) => {
        if (error) reject(error);
        else resolve(derived.toString('hex'));
      });
    });

  it('produces a marker that verifies through the legacy fallback', async () => {
    const hash = await legacyReferenceHash('secret-legacy-pass');
    const { user, anomalies } = transformUser(
      legacyUserSchema.parse({
        _id: '507f1f77bcf86cd799439011',
        email: 'student@example.com',
        firstName: 'Jan',
        lastName: 'Kowalski',
        role: 'student',
        salt,
        hash,
      }),
    );
    expect(anomalies).toEqual([]);
    expect(user.legacyId).toBe('507f1f77bcf86cd799439011');
    expect(user.name).toBe('Jan Kowalski');
    expect(user.legacyPasswordMarker).not.toBeNull();
    const marker = user.legacyPasswordMarker ?? '';
    expect(
      await verifyPasswordWithLegacyFallback({ hash: marker, password: 'secret-legacy-pass' }),
    ).toBe(true);
    expect(await verifyPasswordWithLegacyFallback({ hash: marker, password: 'wrong' })).toBe(false);
  });

  it('backfills a missing role to student and flags missing credentials', () => {
    const { user, anomalies } = transformUser(
      legacyUserSchema.parse({ _id: '507f1f77bcf86cd799439012', email: 'x@example.com' }),
    );
    expect(user.role).toBe('student');
    expect(user.legacyPasswordMarker).toBeNull();
    const kinds = anomalies.map((anomaly) => anomaly.kind).sort();
    expect(kinds).toEqual(['user-role-backfilled', 'user-without-credential']);
  });
});

describe('dedupeProgress', () => {
  const progress = (
    id: string,
    completedLessons: string[],
    updatedAt?: string,
  ): ReturnType<typeof legacyProgressSchema.parse> =>
    legacyProgressSchema.parse({
      _id: id,
      user: 'u1',
      course: 'c1',
      completedLessons,
      updatedAt,
    });

  it('keeps the duplicate with the richest completedLessons', () => {
    const { kept, anomalies } = dedupeProgress([
      progress('p1', ['l1']),
      progress('p2', ['l1', 'l2', 'l2']),
      progress('p3', ['l1', 'l2', 'l3']),
    ]);
    expect(kept.map((doc) => doc._id)).toEqual(['p3']);
    expect(anomalies).toHaveLength(2);
    expect(anomalies.every((anomaly) => anomaly.kind === 'duplicate-progress-deduped')).toBe(true);
  });

  it('breaks completed-lesson ties by updatedAt', () => {
    const { kept } = dedupeProgress([
      progress('p1', ['l1'], '2025-01-01T00:00:00.000Z'),
      progress('p2', ['l2'], '2025-03-01T00:00:00.000Z'),
    ]);
    expect(kept.map((doc) => doc._id)).toEqual(['p2']);
  });

  it('keeps distinct user/course pairs apart', () => {
    const other = legacyProgressSchema.parse({
      _id: 'p9',
      user: 'u2',
      course: 'c1',
      completedLessons: [],
    });
    const { kept, anomalies } = dedupeProgress([progress('p1', ['l1']), other]);
    expect(kept.map((doc) => doc._id)).toEqual(['p1', 'p9']);
    expect(anomalies).toEqual([]);
  });
});

describe('transformChapters', () => {
  it('preserves chapter and content array-item ids verbatim', () => {
    const chapters = [
      legacyChapterSchema.parse({
        id: '6789aaaa1111bbbb2222cccc',
        name: 'Chapter 1',
        contents: [
          { id: '6789aaaa1111bbbb2222dddd', name: 'Intro', courseLesson: 'l1' },
          { id: '6789aaaa1111bbbb2222eeee', name: 'Broken', courseLesson: null },
        ],
      }),
    ];
    const { chapters: transformed, anomalies } = transformChapters('m1', chapters);
    expect(transformed).toEqual([
      {
        id: '6789aaaa1111bbbb2222cccc',
        name: 'Chapter 1',
        contents: [{ id: '6789aaaa1111bbbb2222dddd', name: 'Intro', lessonId: 'l1' }],
      },
    ]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.kind).toBe('chapter-content-without-lesson');
  });
});

describe('transformLessonContents', () => {
  const lookups = {
    videoById: new Map<string, VideoPointer>([
      ['v1', { key: 'videos/intro.mp4', bunnyStreamVideoId: 'bunny-1', bunnyStreamCollectionId: 'col-1' }],
      ['v2', { key: 'videos/broken.mp4', bunnyStreamVideoId: null, bunnyStreamCollectionId: null }],
    ]),
    pdfById: new Map<string, PdfPointer>([
      ['p1', { url: 'https://s3.example.com/pdf-files/cheatsheet.pdf', name: 'Cheatsheet' }],
    ]),
    streamLibraryId: '424242',
  };

  it('inlines media pointers verbatim into typed blocks', () => {
    const { blocks, anomalies } = transformLessonContents(
      'l1',
      [
        { id: 'c1', type: 'video', video: 'v1' },
        { id: 'c2', type: 'pdf', pdf: 'p1' },
        { id: 'c3', type: 'embed', embedLink: 'https://codesandbox.io/embed/x' },
        { id: 'c4', type: 'link', link: 'https://example.com', linkDescription: 'Docs' },
        { id: 'c5', type: 'html', html: '<p>hello</p>' },
      ],
      lookups,
    );
    expect(anomalies).toEqual([]);
    expect(blocks).toEqual([
      {
        type: 'video',
        storageKey: 'videos/intro.mp4',
        streamVideoId: 'bunny-1',
        streamLibraryId: '424242',
        streamCollectionId: 'col-1',
      },
      { type: 'pdf', pdfUrl: 'https://s3.example.com/pdf-files/cheatsheet.pdf', name: 'Cheatsheet' },
      { type: 'embed', embedUrl: 'https://codesandbox.io/embed/x' },
      { type: 'link', url: 'https://example.com', description: 'Docs' },
      { type: 'html', html: '<p>hello</p>' },
    ]);
  });

  it('drops and reports dangling or incomplete media references', () => {
    const { blocks, anomalies } = transformLessonContents(
      'l1',
      [
        { id: 'c1', type: 'video', video: 'missing' },
        { id: 'c2', type: 'video', video: 'v2' },
        { id: 'c3', type: 'pdf', pdf: 'missing' },
      ],
      lookups,
    );
    expect(blocks).toEqual([]);
    expect(anomalies.map((anomaly) => anomaly.kind)).toEqual([
      'dangling-video-ref',
      'video-without-stream-id',
      'dangling-pdf-ref',
    ]);
  });
});
