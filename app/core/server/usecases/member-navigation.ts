import {
  ok,
  type AppError,
  type MemberNavigation,
  type MemberNavigationCourse,
  type Result,
  type Space,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  MemberCourseProgressRepository,
  ProductGrantRepository,
  SpaceRepository,
  SpaceSubscriptionRepository,
} from '../ports.js';
import { fullCourseLookup } from './access.js';
import { requireMemberOrStaff, spaceVisibleToMemberScope } from './community-access.js';
import { resolveMemberAccessLookup } from './entitlements.js';
import { countCourseProgress } from './member-learning.js';

export interface MemberNavigationDeps {
  spaces: SpaceRepository;
  spaceSubscriptions: SpaceSubscriptionRepository;
  grants: ProductGrantRepository;
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: CourseLessonRepository;
  progress: MemberCourseProgressRepository;
  clock: Clock;
}

export const getMemberNavigation = async (
  ctx: Ctx,
  deps: MemberNavigationDeps,
): Promise<Result<MemberNavigation, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'space:read');
  if (!actor.ok) return actor;
  const { tenantId, userId } = actor.value;
  const scope =
    ctx.identity.staffRole === null && ctx.identity.memberId !== null
      ? { tenantId, memberId: ctx.identity.memberId }
      : null;

  const [spaces, courses, modules, lessons] = await Promise.all([
    deps.spaces.list(tenantId),
    deps.courses.list(tenantId),
    deps.modules.list(tenantId),
    deps.lessons.list(tenantId),
  ]);

  const accessibleSpaces: Space[] = [];
  const lockedSpaces: Space[] = [];
  for (const space of spaces) {
    const accessible = scope === null || (await spaceVisibleToMemberScope(scope, space, deps));
    (accessible ? accessibleSpaces : lockedSpaces).push(space);
  }

  const followed = await deps.spaceSubscriptions.listForUser(tenantId, {
    userId,
    spaceIds: accessibleSpaces.map((space) => space.id),
  });
  const followedIds = new Set(followed.map((subscription) => subscription.spaceId));

  const lessonsById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const progressRows = scope === null ? [] : await deps.progress.listByMember(tenantId, scope.memberId);
  const progressByCourse = new Map(progressRows.map((row) => [row.courseId, row]));
  const lookup = scope === null ? null : await resolveMemberAccessLookup(scope, deps);

  const navigationCourses: MemberNavigationCourse[] = [];
  for (const course of courses) {
    const row = progressByCourse.get(course.id);
    const counts = countCourseProgress({
      course,
      modules,
      lessonsById,
      lookup: lookup ?? fullCourseLookup(course.id),
      completedLessonIds: row?.completedLessonIds ?? [],
    });
    if (counts === null) continue;
    navigationCourses.push({
      courseId: course.id,
      courseName: course.name,
      completedLessonCount: counts.completedLessonIds.length,
      accessibleLessonCount: counts.accessibleLessonCount,
      ...(row?.lastViewedLessonId === undefined
        ? {}
        : { lastViewedLessonId: row.lastViewedLessonId }),
      lastActivityAt: row?.updatedAt ?? null,
    });
  }

  return ok({
    spaces: accessibleSpaces.map((space) => ({
      id: space.id,
      slug: space.slug,
      name: space.name,
      visibility: space.visibility,
      position: space.position,
      isFollowing: followedIds.has(space.id),
    })),
    courses: navigationCourses,
    lockedSpaces: lockedSpaces.map((space) => ({
      id: space.id,
      slug: space.slug,
      name: space.name,
      description: space.description,
      productIds: space.productIds,
    })),
  });
};
