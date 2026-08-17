import {
  err,
  notFound,
  ok,
  validation,
  type AppError,
  type Course,
  type CourseLesson,
  type CourseModule,
  type MemberCourseLearningSummary,
  type MemberLearningSummary,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type {
  Clock,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  MemberCourseProgressRepository,
  MemberRepository,
  ProductGrantRepository,
} from '../ports.js';
import { isLessonAccessibleByLookup, linearizeCourse, type AccessLookup } from './access.js';
import { resolveMemberAccessLookup } from './entitlements.js';

export interface CourseProgressCounts {
  accessibleLessonCount: number;
  completedLessonIds: string[];
  lessonNames: Map<string, string>;
}

/** Null when the actor reaches no lesson of the course, which keeps it out of every learning surface. */
export const countCourseProgress = (input: {
  course: Course;
  modules: CourseModule[];
  lessonsById: Map<string, CourseLesson>;
  lookup: AccessLookup;
  completedLessonIds: readonly string[];
}): CourseProgressCounts | null => {
  const lessonNames = new Map<string, string>();
  const accessibleLessonIds = new Set<string>();
  for (const content of linearizeCourse(input.course, input.modules, input.lessonsById)) {
    lessonNames.set(content.lessonId, content.name);
    const location = {
      courseId: input.course.id,
      moduleId: content.moduleId,
      lessonId: content.lessonId,
    };
    if (isLessonAccessibleByLookup(input.lookup, location)) accessibleLessonIds.add(content.lessonId);
  }
  if (accessibleLessonIds.size === 0) return null;
  return {
    accessibleLessonCount: accessibleLessonIds.size,
    completedLessonIds: input.completedLessonIds.filter((lessonId) =>
      accessibleLessonIds.has(lessonId),
    ),
    lessonNames,
  };
};

export interface MemberLearningSummaryDeps {
  members: MemberRepository;
  grants: ProductGrantRepository;
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: CourseLessonRepository;
  progress: MemberCourseProgressRepository;
  clock: Clock;
}

const latestIso = (values: Array<string | null>): string | null =>
  values.reduce<string | null>(
    (latest, value) => (value !== null && (latest === null || value > latest) ? value : latest),
    null,
  );

export const getMemberLearningSummary = async (
  ctx: Ctx,
  memberId: string,
  deps: MemberLearningSummaryDeps,
): Promise<Result<MemberLearningSummary, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:learning:read');
  if (!tenant.ok) return tenant;
  if (!memberId) return err(validation('memberId is required'));

  const member = await deps.members.findById(tenant.value, memberId);
  if (!member) return err(notFound(`No member "${memberId}" in this tenant`));

  const [lookup, courses, modules, lessons, progressRows] = await Promise.all([
    resolveMemberAccessLookup({ tenantId: tenant.value, memberId }, deps),
    deps.courses.list(tenant.value),
    deps.modules.list(tenant.value),
    deps.lessons.list(tenant.value),
    deps.progress.listByMember(tenant.value, memberId),
  ]);

  const lessonsById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const progressByCourse = new Map(progressRows.map((row) => [row.courseId, row]));

  const summaries: MemberCourseLearningSummary[] = [];
  for (const course of courses) {
    const row = progressByCourse.get(course.id);
    const counts = countCourseProgress({
      course,
      modules,
      lessonsById,
      lookup,
      completedLessonIds: row?.completedLessonIds ?? [],
    });
    if (counts === null) continue;

    const latestCompletedId = counts.completedLessonIds.at(-1);
    summaries.push({
      courseId: course.id,
      courseName: course.name,
      completedLessonCount: counts.completedLessonIds.length,
      accessibleLessonCount: counts.accessibleLessonCount,
      lastActivityAt: row?.updatedAt ?? null,
      latestCompletedLesson:
        latestCompletedId === undefined
          ? null
          : { lessonId: latestCompletedId, name: counts.lessonNames.get(latestCompletedId) ?? '' },
    });
  }

  return ok({
    lastActivityAt: latestIso(progressRows.map((row) => row.updatedAt)),
    courses: summaries,
  });
};
