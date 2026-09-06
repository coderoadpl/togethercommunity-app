import {
  appError,
  coursePath,
  err,
  isReservedRedirectPath,
  lessonPath,
  normalizeRedirectPath,
  notFound,
  ok,
  redirectPathSchema,
  validation,
  type AppError,
  type Result,
  type TenantRedirect,
  type TenantRedirectCreateInput,
  type TenantRedirectDeleteInput,
  type TenantRedirectListQuery,
  type TenantRedirectPage,
  type TenantRedirectTargetInput,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  Clock,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  IdGenerator,
  TenantAuditEventRepository,
  TenantRedirectReader,
  TenantRedirectRepository,
} from '../ports.js';

export interface TenantRedirectDeps {
  redirects: TenantRedirectReader;
}

export interface TenantRedirectWriteDeps {
  redirects: TenantRedirectRepository;
  courses: Pick<CourseRepository, 'findById'>;
  modules: Pick<CourseModuleRepository, 'list'>;
  lessons: Pick<CourseLessonRepository, 'findById'>;
  auditEvents: TenantAuditEventRepository;
  ids: IdGenerator;
  clock: Clock;
}

type ResolvedTarget = Pick<TenantRedirect, 'targetKind' | 'targetId' | 'targetPath'>;

const lessonBelongsToCourse = async (
  tenantId: string,
  courseId: string,
  lessonId: string,
  deps: TenantRedirectWriteDeps,
): Promise<boolean> => {
  const modules = await deps.modules.list(tenantId);
  return modules
    .filter((module) => module.courseIds.includes(courseId))
    .some((module) =>
      module.chapters.some((chapter) =>
        chapter.contents.some((content) => content.lessonId === lessonId),
      ),
    );
};

const resolveTarget = async (
  tenantId: string,
  target: TenantRedirectTargetInput,
  deps: TenantRedirectWriteDeps,
): Promise<Result<ResolvedTarget, AppError>> => {
  if (target.kind === 'path') {
    return ok({ targetKind: 'path', targetId: null, targetPath: target.path });
  }
  const course = await deps.courses.findById(tenantId, target.courseId);
  if (course === null) return err(notFound('Course not found'));
  if (target.kind === 'course') {
    return ok({
      targetKind: 'course',
      targetId: course.id,
      targetPath: coursePath(encodeURIComponent(course.id)),
    });
  }
  const lesson = await deps.lessons.findById(tenantId, target.lessonId);
  if (lesson === null) return err(notFound('Lesson not found'));
  if (!await lessonBelongsToCourse(tenantId, course.id, lesson.id, deps)) {
    return err(appError('conflict', 'Lesson does not belong to the selected course'));
  }
  return ok({
    targetKind: 'lesson',
    targetId: lesson.id,
    targetPath: lessonPath(encodeURIComponent(course.id), encodeURIComponent(lesson.id)),
  });
};

export const listTenantRedirects = async (
  ctx: Ctx,
  query: TenantRedirectListQuery,
  deps: TenantRedirectDeps,
): Promise<Result<TenantRedirectPage, AppError>> => {
  const tenantId = authorizeTenant(ctx, 'tenant:domain:read');
  if (!tenantId.ok) return tenantId;
  return ok(await deps.redirects.listPage(tenantId.value, query));
};

export const createTenantRedirect = async (
  ctx: Ctx,
  input: TenantRedirectCreateInput,
  deps: TenantRedirectWriteDeps,
): Promise<Result<TenantRedirect, AppError>> => {
  const tenantId = authorizeTenant(ctx, 'tenant:settings:write');
  if (!tenantId.ok) return tenantId;

  const fromPath = redirectPathSchema.safeParse(normalizeRedirectPath(input.fromPath));
  if (!fromPath.success) return err(validation('Invalid source path'));
  if (isReservedRedirectPath(fromPath.data)) {
    return err(validation(`The platform serves "${fromPath.data}" itself`));
  }

  const target = await resolveTarget(tenantId.value, input.target, deps);
  if (!target.ok) return target;
  if (normalizeRedirectPath(target.value.targetPath) === fromPath.data) {
    return err(validation('A redirect cannot point at its own source path'));
  }
  if (await deps.redirects.findByFromPath(tenantId.value, fromPath.data) !== null) {
    return err(appError('conflict', `Another redirect already answers "${fromPath.data}"`));
  }

  const redirect: TenantRedirect = {
    id: deps.ids.nextId(),
    tenantId: tenantId.value,
    fromPath: fromPath.data,
    ...target.value,
    permanent: input.permanent ?? false,
    origin: 'manual',
    createdBy: ctx.identity.userId,
    createdAt: deps.clock.nowIso(),
  };
  if (await deps.redirects.create(tenantId.value, redirect) !== 'saved') {
    return err(appError('conflict', `Another redirect already answers "${fromPath.data}"`));
  }

  await deps.auditEvents.record(tenantId.value, {
    id: deps.ids.nextId(),
    tenantId: tenantId.value,
    kind: 'redirect_created',
    actorUserId: ctx.identity.userId,
    actorEmail: ctx.identity.email,
    subjectMemberId: null,
    reason: `${redirect.fromPath} to ${redirect.targetPath}`,
    at: deps.clock.nowIso(),
  });

  return ok(redirect);
};

export const deleteTenantRedirect = async (
  ctx: Ctx,
  input: TenantRedirectDeleteInput,
  deps: TenantRedirectWriteDeps,
): Promise<Result<{ id: string }, AppError>> => {
  const tenantId = authorizeTenant(ctx, 'tenant:settings:write');
  if (!tenantId.ok) return tenantId;

  const redirect = await deps.redirects.findById(tenantId.value, input.id);
  if (redirect === null) return err(notFound('Redirect not found'));
  if (!await deps.redirects.deleteById(tenantId.value, redirect.id)) {
    return err(notFound('Redirect not found'));
  }

  await deps.auditEvents.record(tenantId.value, {
    id: deps.ids.nextId(),
    tenantId: tenantId.value,
    kind: 'redirect_deleted',
    actorUserId: ctx.identity.userId,
    actorEmail: ctx.identity.email,
    subjectMemberId: null,
    reason: `${redirect.fromPath} to ${redirect.targetPath}`,
    at: deps.clock.nowIso(),
  });

  return ok({ id: redirect.id });
};
