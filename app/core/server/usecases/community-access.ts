import {
  err,
  forbidden,
  notFound,
  ok,
  tenantNotFound,
  type AppError,
  type Course,
  type CourseLesson,
  type CourseModule,
  type Result,
  type Space,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  ProductGrantRepository,
  SpaceRepository,
} from '../ports.js';
import { isLessonAccessibleByLookup, locateLesson, type AccessLookup } from './access.js';
import { resolveMemberAccessLookup } from './entitlements.js';

export interface TenantScope {
  tenantId: string;
}

export interface ActorScope extends TenantScope {
  userId: string;
}

export interface MemberScope extends ActorScope {
  memberId: string;
}

export const requireTenant = (ctx: Ctx): Result<TenantScope, AppError> =>
  ctx.identity.tenantId ? ok({ tenantId: ctx.identity.tenantId }) : err(tenantNotFound('Select a tenant'));

export const requireActor = (ctx: Ctx): Result<ActorScope, AppError> => {
  const tenant = requireTenant(ctx);
  if (!tenant.ok) return tenant;
  return ok({ tenantId: tenant.value.tenantId, userId: ctx.identity.userId });
};

export const requireMemberOrStaff = (ctx: Ctx): Result<ActorScope, AppError> => {
  const actor = requireActor(ctx);
  if (!actor.ok) return actor;
  if (!ctx.identity.staffRole && !ctx.identity.memberId) {
    return err(forbidden('Only members or staff can use the community'));
  }
  return actor;
};

export const memberScope = (ctx: Ctx): MemberScope | null =>
  ctx.identity.tenantId && ctx.identity.memberId
    ? { tenantId: ctx.identity.tenantId, userId: ctx.identity.userId, memberId: ctx.identity.memberId }
    : null;

export interface LessonAccessDeps {
  courses: CourseRepository;
  modules: CourseModuleRepository;
  grants: ProductGrantRepository;
  clock: Clock;
}

export const lessonContextAccess = async (
  ctx: Ctx,
  lessonId: string,
  deps: LessonAccessDeps,
): Promise<Result<void, AppError>> => {
  const tenant = requireTenant(ctx);
  if (!tenant.ok) return tenant;
  if (ctx.identity.staffRole) return ok(undefined);
  const member = memberScope(ctx);
  if (!member) return err(forbidden('Only members can access lesson discussions'));
  const [courses, modules] = await Promise.all([
    deps.courses.list(tenant.value.tenantId),
    deps.modules.list(tenant.value.tenantId),
  ]);
  const location = locateLesson(lessonId, courses, modules);
  if (!location) return err(forbidden('This lesson is not accessible'));
  const lookup = await resolveMemberAccessLookup(member, deps);
  return isLessonAccessibleByLookup(lookup, {
    courseId: location.course.id,
    moduleId: location.moduleId,
    lessonId,
  })
    ? ok(undefined)
    : err(forbidden('This lesson is not accessible'));
};

export interface AccessibleLessonsDeps extends LessonAccessDeps {
  lessons: CourseLessonRepository;
}

export const accessibleLessonIds = async (
  ctx: Ctx,
  deps: AccessibleLessonsDeps,
): Promise<Result<Set<string>, AppError>> => {
  const tenant = requireTenant(ctx);
  if (!tenant.ok) return tenant;
  const [courses, modules, lessons] = await Promise.all([
    deps.courses.list(tenant.value.tenantId),
    deps.modules.list(tenant.value.tenantId),
    deps.lessons.list(tenant.value.tenantId),
  ]);
  if (ctx.identity.staffRole) return ok(new Set(lessons.map((lesson) => lesson.id)));
  const member = memberScope(ctx);
  if (!member) return err(forbidden('Only members can search discussions'));
  const lookup = await resolveMemberAccessLookup(member, deps);
  return ok(accessibleLessons(courses, modules, lessons, lookup));
};

const accessibleLessons = (
  courses: Course[],
  modules: CourseModule[],
  lessons: CourseLesson[],
  lookup: AccessLookup,
): Set<string> => {
  const ids = new Set<string>();
  for (const lesson of lessons) {
    const location = locateLesson(lesson.id, courses, modules);
    if (
      location &&
      isLessonAccessibleByLookup(lookup, {
        courseId: location.course.id,
        moduleId: location.moduleId,
        lessonId: lesson.id,
      })
    ) {
      ids.add(lesson.id);
    }
  }
  return ids;
};

export interface SpaceAccessDeps {
  spaces: SpaceRepository;
  grants: ProductGrantRepository;
  clock: Clock;
}

/**
 * Entitlement rule for a space, given a resolved membership: 'members'
 * spaces admit every tenant member, 'product' spaces require an active grant
 * for one of the space's products. Staff is handled by the callers.
 */
export const spaceVisibleToMemberScope = async (
  scope: Pick<MemberScope, 'tenantId' | 'memberId'>,
  space: Space,
  deps: Pick<SpaceAccessDeps, 'grants' | 'clock'>,
): Promise<boolean> => {
  if (space.visibility === 'members') return true;
  const activeGrants = await deps.grants.listActiveForMember(
    scope.tenantId,
    scope.memberId,
    deps.clock.nowIso(),
  );
  return activeGrants.some((grant) => space.productIds.includes(grant.productId));
};

export const spaceContextAccess = async (
  ctx: Ctx,
  spaceId: string,
  deps: SpaceAccessDeps,
): Promise<Result<Space, AppError>> => {
  const tenant = requireTenant(ctx);
  if (!tenant.ok) return tenant;
  const space = await deps.spaces.findById(tenant.value.tenantId, spaceId);
  if (!space) return err(notFound('Space not found'));
  if (ctx.identity.staffRole) return ok(space);
  if (space.archivedAt !== null) return err(notFound('Space not found'));
  const member = memberScope(ctx);
  if (!member) return err(forbidden('Only members can access spaces'));
  return (await spaceVisibleToMemberScope(member, space, deps))
    ? ok(space)
    : err(forbidden('This space is not accessible'));
};

export const listAccessibleSpaces = async (
  ctx: Ctx,
  deps: SpaceAccessDeps,
): Promise<Result<Space[], AppError>> => {
  const tenant = requireTenant(ctx);
  if (!tenant.ok) return tenant;
  const spaces = await deps.spaces.list(tenant.value.tenantId);
  if (ctx.identity.staffRole) return ok(spaces);
  const member = memberScope(ctx);
  if (!member) return err(forbidden('Only members can list spaces'));
  const visible: Space[] = [];
  for (const space of spaces) {
    if (await spaceVisibleToMemberScope(member, space, deps)) visible.push(space);
  }
  return ok(visible);
};
