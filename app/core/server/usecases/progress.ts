import {
  err,
  forbidden,
  notFound,
  ok,
  tenantNotFound,
  updateLastViewedInputSchema,
  validation,
  type AppError,
  type MemberCourseProgress,
  type ProgressView,
  type Result,
  type UpdateLastViewedInput,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  CourseModuleRepository,
  CourseRepository,
  IdGenerator,
  MemberCourseProgressRepository,
  ProductGrantRepository,
} from '../ports.js';
import { isLessonAccessibleByLookup, locateLesson } from './access.js';
import { resolveMemberAccessLookup } from './entitlements.js';

export interface ProgressDeps {
  grants: ProductGrantRepository;
  courses: CourseRepository;
  modules: CourseModuleRepository;
  progress: MemberCourseProgressRepository;
  ids: IdGenerator;
  clock: Clock;
}

interface MemberScope {
  tenantId: string;
  memberId: string;
}

const requireMember = (ctx: Ctx): Result<MemberScope, AppError> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to track progress'));
  if (!ctx.identity.memberId) return err(forbidden('Only members have progress'));
  return ok({ tenantId: ctx.identity.tenantId, memberId: ctx.identity.memberId });
};

export const markLessonCompleted = async (
  ctx: Ctx,
  lessonId: string,
  deps: ProgressDeps,
): Promise<Result<MemberCourseProgress, AppError>> => {
  const scope = requireMember(ctx);
  if (!scope.ok) return scope;
  if (!lessonId) return err(validation('lessonId is required'));

  const [courses, modules] = await Promise.all([
    deps.courses.list(scope.value.tenantId),
    deps.modules.list(scope.value.tenantId),
  ]);
  const location = locateLesson(lessonId, courses, modules);
  if (!location) return err(notFound(`No lesson "${lessonId}" in this tenant`));

  const lookup = await resolveMemberAccessLookup(scope.value, deps);
  const accessible = isLessonAccessibleByLookup(lookup, {
    courseId: location.course.id,
    moduleId: location.moduleId,
    lessonId,
  });
  if (!accessible) return err(forbidden('This lesson is not accessible'));

  const current = await deps.progress.findOrCreate(scope.value.tenantId, {
    id: deps.ids.nextId(),
    memberId: scope.value.memberId,
    courseId: location.course.id,
    now: deps.clock.nowIso(),
  });
  if (current.completedLessonIds.includes(lessonId)) return ok(current);

  const updated: MemberCourseProgress = {
    ...current,
    completedLessonIds: [...current.completedLessonIds, lessonId],
    updatedAt: deps.clock.nowIso(),
  };
  const saved = await deps.progress.update(scope.value.tenantId, updated);
  return saved ? ok(saved) : err(notFound('Progress row vanished while updating'));
};

export const updateLastViewed = async (
  ctx: Ctx,
  input: UpdateLastViewedInput,
  deps: ProgressDeps,
): Promise<Result<MemberCourseProgress, AppError>> => {
  const scope = requireMember(ctx);
  if (!scope.ok) return scope;
  const parsed = updateLastViewedInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid last-viewed update', parsed.error.flatten()));

  const course = await deps.courses.findById(scope.value.tenantId, parsed.data.courseId);
  if (!course) return err(notFound(`No course "${parsed.data.courseId}" in this tenant`));

  const current = await deps.progress.findOrCreate(scope.value.tenantId, {
    id: deps.ids.nextId(),
    memberId: scope.value.memberId,
    courseId: course.id,
    now: deps.clock.nowIso(),
  });
  const updated: MemberCourseProgress = {
    ...current,
    lastViewedLessonId: parsed.data.lessonId ?? current.lastViewedLessonId,
    lastViewedModuleId: parsed.data.moduleId ?? current.lastViewedModuleId,
    lastViewedChapterId: parsed.data.chapterId ?? current.lastViewedChapterId,
    updatedAt: deps.clock.nowIso(),
  };
  const saved = await deps.progress.update(scope.value.tenantId, updated);
  return saved ? ok(saved) : err(notFound('Progress row vanished while updating'));
};

export const getProgress = async (
  ctx: Ctx,
  courseId: string,
  deps: Pick<ProgressDeps, 'progress'>,
): Promise<Result<ProgressView, AppError>> => {
  const scope = requireMember(ctx);
  if (!scope.ok) return scope;
  if (!courseId) return err(validation('courseId is required'));

  const existing = await deps.progress.findByMemberAndCourse(scope.value.tenantId, {
    memberId: scope.value.memberId,
    courseId,
  });
  if (!existing) return ok({ courseId, completedLessonIds: [] });

  return ok({
    courseId,
    completedLessonIds: existing.completedLessonIds,
    lastViewedLessonId: existing.lastViewedLessonId,
    lastViewedModuleId: existing.lastViewedModuleId,
    lastViewedChapterId: existing.lastViewedChapterId,
  });
};
