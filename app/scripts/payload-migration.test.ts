import { describe, expect, it } from 'vitest';

import { buildPayloadMigrationPlan, mergeEnrollmentRenewals } from './payload-migration.js';

const ids = {
  crCourse: '000000000000000000000001',
  introCourse: '000000000000000000000002',
  asCourse: '000000000000000000000003',
  crModule: '000000000000000000000011',
  introModule: '000000000000000000000012',
  asModule: '000000000000000000000013',
  crLesson: '000000000000000000000021',
  introLesson: '000000000000000000000022',
  asLesson: '000000000000000000000023',
  video: '000000000000000000000031',
  image: '000000000000000000000041',
  crFull: '000000000000000000000051',
  jsBasics: '000000000000000000000052',
  preview: '000000000000000000000053',
  asFull: '000000000000000000000054',
  user: '000000000000000000000061',
  enrollment1: '000000000000000000000071',
  enrollment2: '000000000000000000000072',
  progress: '000000000000000000000081',
} as const;

const sourceFixture = () => ({
  courses: [
    {
      _id: ids.crCourse,
      name: 'Kurs front-end od A do Z',
      description: 'CR',
      modules: [ids.crModule],
      image: ids.image,
    },
    {
      _id: ids.introCourse,
      name: 'Programowanie – co musisz wiedzieć, zanim zaczniesz?',
      modules: [ids.introModule],
    },
    { _id: ids.asCourse, name: 'AS', modules: [ids.asModule] },
  ],
  modules: [
    {
      _id: ids.crModule,
      title: 'JavaScript',
      prefix: '1',
      courses: [ids.crCourse],
      chapters: [{
        id: 'chapter-cr',
        name: 'Start',
        contents: [{ id: 'content-cr', name: 'Lekcja', courseLesson: ids.crLesson }],
      }],
    },
    {
      _id: ids.introModule,
      title: 'Wprowadzenie',
      courses: [ids.introCourse],
      chapters: [{
        id: 'chapter-intro',
        name: 'Start',
        contents: [{ id: 'content-intro', name: 'Intro', courseLesson: ids.introLesson }],
      }],
    },
    {
      _id: ids.asModule,
      title: 'Excluded',
      courses: [ids.asCourse],
      chapters: [{
        id: 'chapter-as',
        name: 'AS',
        contents: [{ id: 'content-as', name: 'AS', courseLesson: ids.asLesson }],
      }],
    },
  ],
  lessons: [
    {
      _id: ids.crLesson,
      name: 'CR lesson',
      courseModules: [ids.crModule],
      contents: [
        { id: 'video', type: 'video', video: ids.video },
        { id: 'link', type: 'link', link: 'https://example.com', linkDescription: 'Docs' },
        { id: 'html', type: 'html', html: '<style>.x{color:red}</style><p class="x">Treść</p>' },
      ],
    },
    {
      _id: ids.introLesson,
      name: 'Intro lesson',
      courseModules: [ids.introModule],
      contents: [{ id: 'html-intro', type: 'html', html: '<p>Intro</p>' }],
    },
    {
      _id: ids.asLesson,
      name: 'AS lesson',
      courseModules: [ids.asModule],
      contents: [{ id: 'html-as', type: 'html', html: '<p>AS</p>' }],
    },
  ],
  videos: [{
    _id: ids.video,
    key: 'cr/video.mp4',
    bunnyStreamVideoId: 'bunny-video',
    bunnyStreamCollectionId: 'bunny-collection',
  }],
  pdfs: [],
  images: [{ _id: ids.image, prefix: 'course-images', filename: 'course image.png' }],
  accesses: [
    {
      _id: ids.crFull,
      name: 'CR Full Course',
      items: [{ courses: [ids.crCourse], courseLevelAccess: true }],
    },
    {
      _id: ids.jsBasics,
      name: 'CR JS Basics',
      items: [{
        courses: [ids.crCourse],
        courseLevelAccess: false,
        courseModules: [ids.crModule],
        courseModuleLevelAccess: true,
      }],
    },
    {
      _id: ids.preview,
      name: 'Free preview',
      items: [
        {
          courses: [ids.crCourse],
          courseLevelAccess: false,
          courseModules: [ids.crModule],
          courseModuleLevelAccess: false,
          courseLessons: [ids.crLesson],
        },
        { courses: [ids.introCourse], courseLevelAccess: true },
      ],
    },
    {
      _id: ids.asFull,
      name: 'AS Full Course',
      items: [{ courses: [ids.asCourse], courseLevelAccess: true }],
    },
  ],
  enrollments: [
    {
      _id: ids.enrollment1,
      user: ids.user,
      access: ids.crFull,
      startsAt: '2024-01-01T00:00:00.000Z',
      expiresAt: '2024-06-01T00:00:00.000Z',
    },
    {
      _id: ids.enrollment2,
      user: ids.user,
      access: ids.crFull,
      startsAt: '2024-05-01T00:00:00.000Z',
      expiresAt: '2025-06-01T00:00:00.000Z',
    },
  ],
  users: [{
    _id: ids.user,
    email: 'Student@Example.com',
    firstName: 'Jan',
    lastName: 'Kowalski',
    role: 'student',
    salt: 'ab'.repeat(32),
    hash: 'cd'.repeat(512),
  }],
  progress: [{
    _id: ids.progress,
    user: ids.user,
    course: ids.crCourse,
    lastViewedLesson: ids.crLesson,
    lastViewedModule: ids.crModule,
    lastViewedChapter: 'chapter-cr',
    completedLessons: [ids.crLesson, ids.crLesson],
    updatedAt: '2025-01-01T00:00:00.000Z',
  }],
});

describe('buildPayloadMigrationPlan', () => {
  it('applies the owner scope, preserves media values, and builds the three Polish products', () => {
    const plan = buildPayloadMigrationPlan(sourceFixture());

    expect(plan.selectedCounts).toMatchObject({
      courses: 2,
      modules: 2,
      lessons: 2,
      products: 3,
      users: 1,
      grants: 1,
      progress: 1,
    });
    expect(plan.bundle.courses[0]?.imageUrl).toBe(
      'https://app-coderoad-pl.s3.eu-central-1.amazonaws.com/course-images/course%20image.png',
    );
    expect(plan.bundle.lessons[0]?.contents).toEqual([
      {
        type: 'video',
        storageKey: 'cr/video.mp4',
        streamVideoId: 'bunny-video',
        streamCollectionId: 'bunny-collection',
      },
      { type: 'link', url: 'https://example.com', description: 'Docs' },
      { type: 'html', html: '<style>.x{color:red}</style><p class="x">Treść</p>' },
    ]);
    expect(plan.bundle.products.map((product) => product.title)).toEqual([
      'Pełny kurs CodeRoad',
      'Podstawy JavaScript CodeRoad',
      'Darmowy podgląd',
    ]);
    expect(plan.bundle.products[2]?.accessItems).toEqual([
      { level: 'lessons', courseId: ids.crCourse, lessonIds: [ids.crLesson] },
      { level: 'course', courseId: ids.introCourse },
    ]);
    expect(plan.bundle.users[0]?.email).toBe('student@example.com');
    expect(plan.bundle.users[0]?.payloadPasswordMarker).toBe(
      `pbkdf2$25000$${'ab'.repeat(32)}$${'cd'.repeat(512)}`,
    );
    expect(plan.bundle.progress[0]?.completedLessonIds).toEqual([ids.crLesson]);
    expect(plan.renewalMerges).toHaveLength(1);
    expect(plan.bundle.grants[0]).toMatchObject({
      startsAt: '2024-01-01T00:00:00.000Z',
      expiresAt: '2025-06-01T00:00:00.000Z',
    });
  });
});

describe('mergeEnrollmentRenewals', () => {
  it('uses the earliest start and latest expiry with a stable pair key', () => {
    const input = [{
      memberLegacyId: ids.user,
      productLegacyId: ids.crFull,
      rows: sourceFixture().enrollments,
    }];
    const first = mergeEnrollmentRenewals(input);
    const second = mergeEnrollmentRenewals(input);

    expect(first.grants).toEqual(second.grants);
    expect(first.grants[0]).toMatchObject({
      startsAt: '2024-01-01T00:00:00.000Z',
      expiresAt: '2025-06-01T00:00:00.000Z',
    });
    expect(first.merges[0]?.enrollmentLegacyIds).toEqual([
      ids.enrollment1,
      ids.enrollment2,
    ]);
  });
});
