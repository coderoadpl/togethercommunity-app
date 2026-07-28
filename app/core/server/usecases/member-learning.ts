import {
  err,
  notFound,
  ok,
  validation,
  type AppError,
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
import { isLessonAccessibleByLookup, linearizeCourse } from './access.js';
import { resolveMemberAccessLookup } from './entitlements.js';

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
    const nameByLessonId = new Map<string, string>();
    const accessibleLessonIds = new Set<string>();
    for (const content of linearizeCourse(course, modules, lessonsById)) {
      nameByLessonId.set(content.lessonId, content.name);
      const location = {
        courseId: course.id,
        moduleId: content.moduleId,
        lessonId: content.lessonId,
      };
      if (isLessonAccessibleByLookup(lookup, location)) accessibleLessonIds.add(content.lessonId);
    }
    if (accessibleLessonIds.size === 0) continue;

    const row = progressByCourse.get(course.id);
    const completedLessonIds = (row?.completedLessonIds ?? []).filter((lessonId) =>
      accessibleLessonIds.has(lessonId),
    );
    const latestCompletedId = completedLessonIds.at(-1);
    summaries.push({
      courseId: course.id,
      courseName: course.name,
      completedLessonCount: completedLessonIds.length,
      accessibleLessonCount: accessibleLessonIds.size,
      lastActivityAt: row?.updatedAt ?? null,
      latestCompletedLesson:
        latestCompletedId === undefined
          ? null
          : { lessonId: latestCompletedId, name: nameByLessonId.get(latestCompletedId) ?? '' },
    });
  }

  return ok({
    lastActivityAt: latestIso(progressRows.map((row) => row.updatedAt)),
    courses: summaries,
  });
};
