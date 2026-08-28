import {
  ok,
  type AppError,
  type MemberNavigation,
  type MemberNavigationCourse,
  type Product,
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
  PostRepository,
  ProductGrantRepository,
  ProductRepository,
  SpaceRepository,
  SpaceSeenRepository,
  SpaceSubscriptionRepository,
} from '../ports.js';
import { fullCourseLookup } from './access.js';
import { requireMemberOrStaff, spaceVisibleToMemberScope } from './community-access.js';
import { resolveMemberAccessLookup } from './entitlements.js';
import { countCourseProgress } from './member-learning.js';

export interface MemberNavigationDeps {
  spaces: SpaceRepository;
  spaceSubscriptions: SpaceSubscriptionRepository;
  spaceSeen: SpaceSeenRepository;
  posts: PostRepository;
  grants: ProductGrantRepository;
  products: ProductRepository;
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: CourseLessonRepository;
  progress: MemberCourseProgressRepository;
  clock: Clock;
}

const hasUnreadPosts = (latestPostAt: string | undefined, seenAt: string | undefined): boolean =>
  latestPostAt !== undefined && (seenAt === undefined || latestPostAt > seenAt);

const courseIdsByProduct = (
  products: Product[],
  knownCourseIds: Set<string>,
): Map<string, string[]> =>
  new Map(
    products.map((product) => [
      product.id,
      [...new Set(product.accessItems.map((item) => item.courseId))].filter((courseId) =>
        knownCourseIds.has(courseId),
      ),
    ]),
  );

const spaceCourseIds = (space: Space, coursesByProduct: Map<string, string[]>): string[] =>
  space.visibility === 'product'
    ? [...new Set(space.productIds.flatMap((productId) => coursesByProduct.get(productId) ?? []))]
    : [];

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

  const [spaces, courses, modules, lessons, products] = await Promise.all([
    deps.spaces.list(tenantId),
    deps.courses.list(tenantId),
    deps.modules.list(tenantId),
    deps.lessons.list(tenantId),
    deps.products.listByTenant(tenantId),
  ]);
  const coursesByProduct = courseIdsByProduct(
    products,
    new Set(courses.map((course) => course.id)),
  );

  const publishedProductIds = new Set(
    products.filter((product) => product.published).map((product) => product.id),
  );
  const accessibleSpaces: Space[] = [];
  const lockedSpaces: Space[] = [];
  for (const space of spaces) {
    const accessible = scope === null || (await spaceVisibleToMemberScope(scope, space, deps));
    if (accessible) accessibleSpaces.push(space);
    else if (space.productIds.some((productId) => publishedProductIds.has(productId))) {
      lockedSpaces.push(space);
    }
  }

  const accessibleSpaceIds = accessibleSpaces.map((space) => space.id);
  const [followed, latestPostAt, seenMarks] = await Promise.all([
    deps.spaceSubscriptions.listForUser(tenantId, { userId, spaceIds: accessibleSpaceIds }),
    deps.posts.latestRootPostAt(tenantId, accessibleSpaceIds),
    deps.spaceSeen.listForUser(tenantId, { userId, spaceIds: accessibleSpaceIds }),
  ]);
  const followedIds = new Set(followed.map((subscription) => subscription.spaceId));
  const seenAtBySpace = new Map(seenMarks.map((mark) => [mark.spaceId, mark.seenAt]));

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
      unread: hasUnreadPosts(latestPostAt.get(space.id), seenAtBySpace.get(space.id)),
      courseIds: spaceCourseIds(space, coursesByProduct),
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
