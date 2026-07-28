import {
  err,
  forbidden,
  notFound,
  ok,
  tenantNotFound,
  validation,
  type AccessItem,
  type AppError,
  type Course,
  type CourseLesson,
  type CourseStructureWithAccess,
  type NextLesson,
  type Product,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  MemberCourseProgressRepository,
  ProductGrantRepository,
  ProductRepository,
} from '../ports.js';
import {
  aggregateAccessItems,
  buildAccessLookup,
  buildCourseStructure,
  fullCourseLookup,
  isLessonAccessibleByLookup,
  linearizeCourse,
  locateLesson,
  type AccessLookup,
} from './access.js';

export interface EntitlementsDeps {
  grants: ProductGrantRepository;
  clock: Clock;
}

export interface CourseAccessDeps extends EntitlementsDeps {
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: CourseLessonRepository;
  progress: MemberCourseProgressRepository;
  products: ProductRepository;
}

interface MemberScope {
  tenantId: string;
  memberId: string;
}

const requireTenant = (ctx: Ctx): Result<string, AppError> =>
  ctx.identity.tenantId
    ? ok(ctx.identity.tenantId)
    : err(tenantNotFound('Select a tenant to view courses'));

const requireMember = (ctx: Ctx): Result<MemberScope, AppError> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to view courses'));
  if (!ctx.identity.memberId) return err(forbidden('Only members have entitlements'));
  return ok({ tenantId: ctx.identity.tenantId, memberId: ctx.identity.memberId });
};

const isStaff = (ctx: Ctx): boolean => ctx.identity.staffRole !== null;

export const resolveMemberEntitlements = async (
  ctx: Ctx,
  deps: EntitlementsDeps,
): Promise<Result<AccessItem[], AppError>> => {
  const scope = requireMember(ctx);
  if (!scope.ok) return scope;

  const now = deps.clock.nowIso();
  const activeGrants = await deps.grants.listActiveForMember(
    scope.value.tenantId,
    scope.value.memberId,
    now,
  );
  if (activeGrants.length === 0) return ok([]);

  const activeProductIds = new Set(activeGrants.map((grant) => grant.productId));
  const grantedProducts = await deps.grants.listGrantedProducts(
    scope.value.tenantId,
    scope.value.memberId,
  );
  const activeProducts = grantedProducts.filter((product) => activeProductIds.has(product.id));
  return ok(aggregateAccessItems(activeProducts));
};

export const resolveMemberAccessLookup = async (
  scope: MemberScope,
  deps: EntitlementsDeps,
): Promise<AccessLookup> => {
  const now = deps.clock.nowIso();
  const activeGrants = await deps.grants.listActiveForMember(scope.tenantId, scope.memberId, now);
  if (activeGrants.length === 0) return buildAccessLookup([]);
  const activeProductIds = new Set(activeGrants.map((grant) => grant.productId));
  const grantedProducts = await deps.grants.listGrantedProducts(scope.tenantId, scope.memberId);
  const activeProducts = grantedProducts.filter((product) => activeProductIds.has(product.id));
  return buildAccessLookup(aggregateAccessItems(activeProducts));
};

const lessonMap = (lessons: CourseLesson[]): Map<string, CourseLesson> =>
  new Map(lessons.map((lesson) => [lesson.id, lesson]));

export const isLessonAccessible = async (
  ctx: Ctx,
  lessonId: string,
  deps: CourseAccessDeps,
): Promise<Result<void, AppError>> => {
  const tenant = requireTenant(ctx);
  if (!tenant.ok) return tenant;
  if (!lessonId) return err(validation('lessonId is required'));
  if (isStaff(ctx)) return ok(undefined);
  if (!ctx.identity.memberId) return err(forbidden('Only members have entitlements'));

  const [courses, modules] = await Promise.all([
    deps.courses.list(tenant.value),
    deps.modules.list(tenant.value),
  ]);
  const location = locateLesson(lessonId, courses, modules);
  if (!location) return err(notFound(`No lesson "${lessonId}" in this tenant`));

  const lookup = await resolveMemberAccessLookup(
    { tenantId: tenant.value, memberId: ctx.identity.memberId },
    deps,
  );
  const accessible = isLessonAccessibleByLookup(lookup, {
    courseId: location.course.id,
    moduleId: location.moduleId,
    lessonId,
  });
  return accessible ? ok(undefined) : err(forbidden('This lesson is not accessible'));
};

export const getAccessibleLesson = async (
  ctx: Ctx,
  lessonId: string,
  deps: CourseAccessDeps,
): Promise<Result<CourseLesson, AppError>> => {
  const access = await isLessonAccessible(ctx, lessonId, deps);
  if (!access.ok) return access;

  const tenant = requireTenant(ctx);
  if (!tenant.ok) return tenant;
  const lesson = await deps.lessons.findById(tenant.value, lessonId);
  if (!lesson) return err(notFound(`No lesson "${lessonId}" in this tenant`));
  return ok(lesson);
};

export const getCourseStructureWithAccess = async (
  ctx: Ctx,
  courseId: string,
  deps: CourseAccessDeps,
): Promise<Result<CourseStructureWithAccess, AppError>> => {
  const tenant = requireTenant(ctx);
  if (!tenant.ok) return tenant;
  if (!courseId) return err(validation('courseId is required'));
  if (!isStaff(ctx) && !ctx.identity.memberId) {
    return err(forbidden('Only members or staff can view course structure'));
  }

  const course = await deps.courses.findById(tenant.value, courseId);
  if (!course) return err(notFound(`No course "${courseId}" in this tenant`));

  const [modules, lessons] = await Promise.all([
    deps.modules.list(tenant.value),
    deps.lessons.list(tenant.value),
  ]);

  let lookup: AccessLookup;
  let completedLessonIds = new Set<string>();
  let publishedProducts: Product[] = [];
  if (isStaff(ctx)) {
    lookup = fullCourseLookup(course.id);
  } else if (ctx.identity.memberId) {
    const scope = { tenantId: tenant.value, memberId: ctx.identity.memberId };
    lookup = await resolveMemberAccessLookup(scope, deps);
    const existing = await deps.progress.findByMemberAndCourse(tenant.value, {
      memberId: scope.memberId,
      courseId: course.id,
    });
    if (existing) completedLessonIds = new Set(existing.completedLessonIds);
    publishedProducts = await deps.products.listPublishedByTenant(tenant.value);
  } else {
    lookup = buildAccessLookup([]);
  }

  return ok(
    buildCourseStructure(
      course,
      modules,
      lessonMap(lessons),
      lookup,
      completedLessonIds,
      publishedProducts,
    ),
  );
};

export const listMyCourses = async (
  ctx: Ctx,
  deps: CourseAccessDeps,
): Promise<Result<Course[], AppError>> => {
  const tenant = requireTenant(ctx);
  if (!tenant.ok) return tenant;

  const courses = await deps.courses.list(tenant.value);
  if (isStaff(ctx)) return ok(courses);
  if (!ctx.identity.memberId) return err(forbidden('Only members can list their courses'));

  const [modules, lessons] = await Promise.all([
    deps.modules.list(tenant.value),
    deps.lessons.list(tenant.value),
  ]);
  const lookup = await resolveMemberAccessLookup(
    { tenantId: tenant.value, memberId: ctx.identity.memberId },
    deps,
  );
  const lessonsById = lessonMap(lessons);
  const accessible = courses.filter((course) => {
    const structure = buildCourseStructure(course, modules, lessonsById, lookup, new Set());
    return structure.accessStatus !== 'not-accessible';
  });
  return ok(accessible);
};

export const getNextLesson = async (
  ctx: Ctx,
  lessonId: string,
  deps: CourseAccessDeps,
): Promise<Result<NextLesson, AppError>> => {
  const tenant = requireTenant(ctx);
  if (!tenant.ok) return tenant;
  if (!lessonId) return err(validation('lessonId is required'));
  if (!isStaff(ctx) && !ctx.identity.memberId) {
    return err(forbidden('Only members or staff can navigate lessons'));
  }

  const [courses, modules, lessons] = await Promise.all([
    deps.courses.list(tenant.value),
    deps.modules.list(tenant.value),
    deps.lessons.list(tenant.value),
  ]);
  const location = locateLesson(lessonId, courses, modules);
  if (!location) return err(notFound(`No lesson "${lessonId}" in this tenant`));

  const linear = linearizeCourse(location.course, modules, lessonMap(lessons));
  const index = linear.findIndex((content) => content.lessonId === lessonId);
  const next = index >= 0 ? linear[index + 1] : undefined;
  return ok(next ? { id: next.lessonId, name: next.name } : null);
};
