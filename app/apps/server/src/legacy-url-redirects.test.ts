import { describe, expect, it } from 'vitest';

import type { Course, CourseLesson, CourseModule } from '#core/domain/index.js';
import type { LegacyContentLocator } from '#core/server/index.js';

import { legacyContentRef, legacyRedirect } from './legacy-url-redirects.js';

const MONGO_COURSE = '656b8fa6e74246956889b096';
const MONGO_MODULE = '65a52510b5bd26b9d2ab3aa1';
const MONGO_CHAPTER = '65a52510b5bd26b9d2ab3ccc';
const MONGO_LESSON = '65a52510b5bd26b9d2ab3b77';

const course: Course = {
  id: 'acme-656b8fa6e74246956889b096',
  tenantId: 't-acme',
  name: 'JavaScript',
  description: '',
  imageUrl: null,
  moduleOrder: ['module-row'],
  publiclyVisible: false,
  legacyId: MONGO_COURSE,
  createdAt: '1998-07-12T00:00:00.000Z',
};

const courseModule: CourseModule = {
  id: 'module-row',
  tenantId: 't-acme',
  courseIds: [course.id],
  title: 'Variables',
  prefix: null,
  name: 'Variables',
  chapters: [
    { id: 'chapter-empty', name: 'Intro', contents: [] },
    {
      id: MONGO_CHAPTER,
      name: 'Basics',
      contents: [
        { id: 'content-1', name: 'let', lessonId: 'lesson-row' },
        { id: 'content-2', name: 'const', lessonId: 'lesson-second' },
      ],
    },
    {
      id: 'chapter-last',
      name: 'Advanced',
      contents: [{ id: 'content-3', name: 'scope', lessonId: 'lesson-third' }],
    },
  ],
  legacyId: MONGO_MODULE,
  createdAt: '1998-07-12T00:00:00.000Z',
};

const lesson: CourseLesson = {
  id: 'lesson-row',
  tenantId: 't-acme',
  name: 'let',
  isPreview: false,
  contents: [],
  legacyId: MONGO_LESSON,
  createdAt: '1998-07-12T00:00:00.000Z',
};

const locator = (input: {
  courses?: Course[];
  modules?: CourseModule[];
  lessons?: CourseLesson[];
} = {}): LegacyContentLocator => {
  const courses = input.courses ?? [course];
  const modules = input.modules ?? [courseModule];
  const lessons = input.lessons ?? [lesson];
  const find = <T extends { tenantId: string; legacyId: string | null }>(rows: T[]) =>
    async (tenantId: string, legacyId: string): Promise<T | null> =>
      rows.find((row) => row.tenantId === tenantId && row.legacyId === legacyId) ?? null;
  return {
    findCourse: find(courses),
    findModule: find(modules),
    findLesson: find(lessons),
  };
};

const redirect = (
  ref: Parameters<typeof legacyRedirect>[1],
  tenantId = 't-acme',
) => legacyRedirect(tenantId, ref, locator());

const COURSE_PAGE = `/my/courses/${course.id}`;
const LESSON_PAGE = `${COURSE_PAGE}/lessons/${lesson.id}`;
const COURSE_LIST = { path: '/my', permanent: false };

describe('legacy path parsing', () => {
  it('reads every legacy shape, with or without a trailing slash', () => {
    expect(legacyContentRef(`/courses/${MONGO_COURSE}`)).toEqual({
      course: MONGO_COURSE,
      module: undefined,
      chapter: undefined,
      lesson: undefined,
    });
    expect(legacyContentRef(`/courses/${MONGO_COURSE}/`)?.course).toBe(MONGO_COURSE);
    expect(legacyContentRef(`/courses/${MONGO_COURSE}/modules/${MONGO_MODULE}/`)).toEqual({
      course: MONGO_COURSE,
      module: MONGO_MODULE,
      chapter: undefined,
      lesson: undefined,
    });
    expect(
      legacyContentRef(
        `/courses/${MONGO_COURSE}/modules/${MONGO_MODULE}/chapters/${MONGO_CHAPTER}/lessons/${MONGO_LESSON}`,
      ),
    ).toEqual({
      course: MONGO_COURSE,
      module: MONGO_MODULE,
      chapter: MONGO_CHAPTER,
      lesson: MONGO_LESSON,
    });
  });

  it('rejects paths that are not a legacy shape', () => {
    expect(legacyContentRef('/courses/')).toBeNull();
    expect(legacyContentRef(`/courses/${MONGO_COURSE}/modules`)).toBeNull();
    expect(legacyContentRef(`/courses/${MONGO_COURSE}/lessons/${MONGO_LESSON}`)).toBeNull();
  });
});

describe('legacy redirect destination', () => {
  it('maps a course link to the member course page for good', async () => {
    await expect(redirect({ course: MONGO_COURSE })).resolves.toEqual({
      path: COURSE_PAGE,
      permanent: true,
    });
  });

  it('maps a lesson link to the member lesson page for good', async () => {
    await expect(
      redirect({
        course: MONGO_COURSE,
        module: MONGO_MODULE,
        chapter: MONGO_CHAPTER,
        lesson: MONGO_LESSON,
      }),
    ).resolves.toEqual({ path: LESSON_PAGE, permanent: true });
  });

  it('maps a module link to its first lesson, temporarily', async () => {
    await expect(redirect({ course: MONGO_COURSE, module: MONGO_MODULE })).resolves.toEqual({
      path: LESSON_PAGE,
      permanent: false,
    });
  });

  it('maps a chapter link to the first lesson of that chapter', async () => {
    await expect(
      redirect({ course: MONGO_COURSE, module: MONGO_MODULE, chapter: 'chapter-last' }),
    ).resolves.toEqual({ path: `${COURSE_PAGE}/lessons/lesson-third`, permanent: false });
  });

  it('falls back to the first lesson of the module for an empty or unknown chapter', async () => {
    await expect(
      redirect({ course: MONGO_COURSE, module: MONGO_MODULE, chapter: 'chapter-empty' }),
    ).resolves.toEqual({ path: LESSON_PAGE, permanent: false });
    await expect(
      redirect({ course: MONGO_COURSE, module: MONGO_MODULE, chapter: 'chapter-gone' }),
    ).resolves.toEqual({ path: LESSON_PAGE, permanent: false });
  });

  it('falls back to the course page, temporarily, when the module holds no lesson', async () => {
    const emptyModule: CourseModule = { ...courseModule, chapters: [] };
    await expect(
      legacyRedirect(
        't-acme',
        { course: MONGO_COURSE, module: MONGO_MODULE },
        locator({ modules: [emptyModule] }),
      ),
    ).resolves.toEqual({ path: COURSE_PAGE, permanent: false });
  });

  it('falls back to the course page when the module belongs to another course', async () => {
    const detached: CourseModule = { ...courseModule, courseIds: ['course-other'] };
    await expect(
      legacyRedirect(
        't-acme',
        { course: MONGO_COURSE, module: MONGO_MODULE },
        locator({ modules: [detached] }),
      ),
    ).resolves.toEqual({ path: COURSE_PAGE, permanent: false });
  });

  it('falls back to the course page for an unknown module or lesson', async () => {
    await expect(
      redirect({ course: MONGO_COURSE, module: 'unknownmodule' }),
    ).resolves.toEqual({ path: COURSE_PAGE, permanent: false });
    await expect(
      redirect({ course: MONGO_COURSE, module: MONGO_MODULE, lesson: 'unknownlesson' }),
    ).resolves.toEqual({ path: COURSE_PAGE, permanent: false });
  });

  it('refuses a lesson that lives outside the referenced module', async () => {
    const foreign: CourseLesson = { ...lesson, id: 'lesson-elsewhere', legacyId: 'otherlesson' };
    await expect(
      legacyRedirect(
        't-acme',
        { course: MONGO_COURSE, module: MONGO_MODULE, lesson: 'otherlesson' },
        locator({ lessons: [lesson, foreign] }),
      ),
    ).resolves.toEqual({ path: COURSE_PAGE, permanent: false });
  });

  it('sends a course owned by another workspace to the course list', async () => {
    await expect(redirect({ course: MONGO_COURSE }, 't-globex')).resolves.toEqual(COURSE_LIST);
    await expect(
      redirect({ course: MONGO_COURSE, module: MONGO_MODULE, lesson: MONGO_LESSON }, 't-globex'),
    ).resolves.toEqual(COURSE_LIST);
  });

  it('sends an unknown course to the course list', async () => {
    await expect(redirect({ course: 'deadbeefdeadbeefdeadbeef' })).resolves.toEqual(COURSE_LIST);
  });

  it('sends identifiers that are not plain segments to the course list', async () => {
    await expect(redirect({ course: '' })).resolves.toEqual(COURSE_LIST);
    await expect(redirect({ course: `${MONGO_COURSE}.json` })).resolves.toEqual(COURSE_LIST);
    await expect(redirect({ course: 'x'.repeat(65) })).resolves.toEqual(COURSE_LIST);
    await expect(
      redirect({ course: MONGO_COURSE, module: '..' }),
    ).resolves.toEqual({ path: COURSE_PAGE, permanent: false });
  });

  it('escapes identifiers that would otherwise reshape the destination', async () => {
    const hostile: Course = { ...course, id: '/evil.example.com' };
    await expect(
      legacyRedirect('t-acme', { course: MONGO_COURSE }, locator({ courses: [hostile] })),
    ).resolves.toEqual({ path: '/my/courses/%2Fevil.example.com', permanent: true });
  });
});
