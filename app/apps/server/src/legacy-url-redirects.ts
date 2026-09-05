import type { Hono } from 'hono';

import { coursePath, lessonPath, MEMBER_ROUTE_PATHS, TENANT_HEADER } from '#core/contract/index.js';
import type { Chapter, Course, CourseModule } from '#core/domain/index.js';
import { type LegacyContentLocator, resolveTenant } from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import type { AppVars } from './app-vars.js';

export const LEGACY_COURSE_ROUTE = '/courses/*';

const LEGACY_PATH_PATTERN =
  /^\/courses\/(?<course>[^/]+)(?:\/modules\/(?<module>[^/]+)(?:\/chapters\/(?<chapter>[^/]+)(?:\/lessons\/(?<lesson>[^/]+))?)?)?\/?$/;

const LEGACY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface LegacyContentRef {
  course: string;
  module?: string | undefined;
  chapter?: string | undefined;
  lesson?: string | undefined;
}

export interface LegacyRedirect {
  path: string;
  permanent: boolean;
}

const COURSE_LIST: LegacyRedirect = { path: MEMBER_ROUTE_PATHS.courseList, permanent: false };

const memberCoursePath = (course: Course): string => coursePath(encodeURIComponent(course.id));

const memberLessonPath = (course: Course, lessonId: string): string =>
  lessonPath(encodeURIComponent(course.id), encodeURIComponent(lessonId));

const firstLessonId = (chapters: readonly Chapter[]): string | null =>
  chapters.flatMap((chapter) => chapter.contents)[0]?.lessonId ?? null;

const derivedLessonId = (found: CourseModule, chapterId: string | undefined): string | null => {
  const chapter = found.chapters.find(({ id }) => id === chapterId);
  return (chapter === undefined ? null : firstLessonId([chapter])) ?? firstLessonId(found.chapters);
};

const referencedLessonId = async (
  tenantId: string,
  found: CourseModule,
  legacyLessonId: string,
  locator: LegacyContentLocator,
): Promise<string | null> => {
  if (!LEGACY_ID_PATTERN.test(legacyLessonId)) return null;
  const lesson = await locator.findLesson(tenantId, legacyLessonId);
  if (lesson === null) return null;
  const holdsLesson = found.chapters.some((chapter) =>
    chapter.contents.some((content) => content.lessonId === lesson.id),
  );
  return holdsLesson ? lesson.id : null;
};

export const legacyRedirect = async (
  tenantId: string,
  ref: LegacyContentRef,
  locator: LegacyContentLocator,
): Promise<LegacyRedirect> => {
  if (!LEGACY_ID_PATTERN.test(ref.course)) return COURSE_LIST;
  const course = await locator.findCourse(tenantId, ref.course);
  if (course === null) return COURSE_LIST;
  const coursePage = memberCoursePath(course);
  if (ref.module === undefined) return { path: coursePage, permanent: true };
  const derivedCoursePage: LegacyRedirect = { path: coursePage, permanent: false };
  if (!LEGACY_ID_PATTERN.test(ref.module)) return derivedCoursePage;
  const found = await locator.findModule(tenantId, ref.module);
  if (found === null || !found.courseIds.includes(course.id)) return derivedCoursePage;
  if (ref.lesson !== undefined) {
    const lessonId = await referencedLessonId(tenantId, found, ref.lesson, locator);
    return lessonId === null
      ? derivedCoursePage
      : { path: memberLessonPath(course, lessonId), permanent: true };
  }
  const lessonId = derivedLessonId(found, ref.chapter);
  return lessonId === null
    ? derivedCoursePage
    : { path: memberLessonPath(course, lessonId), permanent: false };
};

export const legacyContentRef = (path: string): LegacyContentRef | null => {
  const groups = LEGACY_PATH_PATTERN.exec(path)?.groups;
  if (groups === undefined) return null;
  return {
    course: groups['course'] ?? '',
    module: groups['module'],
    chapter: groups['chapter'],
    lesson: groups['lesson'],
  };
};

export const registerLegacyUrlRedirects = (app: Hono<AppVars>, deps: AppDeps): void => {
  app.on('GET', LEGACY_COURSE_ROUTE, async (c, next) => {
    const tenant = await resolveTenant(
      c.req.header('host') ?? '',
      c.req.header(TENANT_HEADER) ?? null,
      deps,
    );
    if (!tenant.ok || tenant.value === null) {
      await next();
      return;
    }
    const ref = legacyContentRef(c.req.path);
    const redirect =
      ref === null ? COURSE_LIST : await legacyRedirect(tenant.value.tenant.id, ref, deps.legacyContent);
    return c.redirect(
      `${redirect.path}${new URL(c.req.url).search}`,
      redirect.permanent ? 301 : 302,
    );
  });
};
