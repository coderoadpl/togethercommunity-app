import {
  err,
  forbidden,
  notFound,
  ok,
  updateLastViewedInputSchema,
  validation,
  type AppError,
  type Capability,
  type CourseResume,
  type MemberCourseProgress,
  type ProgressView,
  type Result,
  type UpdateLastViewedInput,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type {
  Clock,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  IdGenerator,
  MemberCourseProgressRepository,
  MemberRepository,
  ProductGrantRepository,
} from '../ports.js';
import { buildCourseStructure, fullCourseLookup, isLessonAccessibleByLookup, locateLesson } from './access.js';
import { resolveMemberAccessLookup } from './entitlements.js';
import { resolveCourseResume } from './course-resume.js';
import { requireLiveMember } from './member-status.js';

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

const requireMember = (ctx: Ctx, capability: Capability): Result<MemberScope, AppError> => {
  const tenant = authorizeTenant(ctx, capability);
  if (!tenant.ok) return tenant;
  if (!ctx.identity.memberId) return err(forbidden('Only members have progress'));
  return ok({ tenantId: tenant.value, memberId: ctx.identity.memberId });
};

export const markLessonCompleted = async (
  ctx: Ctx,
  lessonId: string,
  deps: ProgressDeps,
): Promise<Result<MemberCourseProgress, AppError>> => {
  const scope = requireMember(ctx, 'member:progress:self-write');
  if (!scope.ok) return scope;
  if (!lessonId) return err(validation('lessonId is required'));

  const [courses, modules] = await Promise.all([
    deps.courses.list(scope.value.tenantId),
    deps.modules.list(scope.value.tenantId),
  ]);
  const location = locateLesson(lessonId, courses, modules);
  if (!location) return err(notFound(`No lesson "${lessonId}" in this tenant`));

  const lookup = await resolveMemberAccessLookup(scope.value, deps);
  const accessible = ctx.identity.staffRole !== null || isLessonAccessibleByLookup(lookup, {
    courseId: location.course.id,
    moduleId: location.moduleId,
    lessonId,
  });
  if (!accessible) return err(forbidden('This lesson is not accessible'));

  return ok(await deps.progress.addCompletedLesson(scope.value.tenantId, {
    id: deps.ids.nextId(),
    memberId: scope.value.memberId,
    courseId: location.course.id,
    lessonId,
    now: deps.clock.nowIso(),
  }));
};

export const unmarkLessonCompleted = async (
  ctx: Ctx,
  lessonId: string,
  deps: ProgressDeps,
): Promise<Result<MemberCourseProgress, AppError>> => {
  const scope = requireMember(ctx, 'member:progress:self-write');
  if (!scope.ok) return scope;
  if (!lessonId) return err(validation('lessonId is required'));

  const [courses, modules] = await Promise.all([
    deps.courses.list(scope.value.tenantId),
    deps.modules.list(scope.value.tenantId),
  ]);
  const location = locateLesson(lessonId, courses, modules);
  if (!location) return err(notFound(`No lesson "${lessonId}" in this tenant`));

  const lookup = await resolveMemberAccessLookup(scope.value, deps);
  const accessible = ctx.identity.staffRole !== null || isLessonAccessibleByLookup(lookup, {
    courseId: location.course.id,
    moduleId: location.moduleId,
    lessonId,
  });
  if (!accessible) return err(forbidden('This lesson is not accessible'));

  const now = deps.clock.nowIso();
  const removed = await deps.progress.removeCompletedLesson(scope.value.tenantId, {
    memberId: scope.value.memberId,
    courseId: location.course.id,
    lessonId,
    now,
  });
  return ok(removed ?? {
    id: deps.ids.nextId(),
    tenantId: scope.value.tenantId,
    memberId: scope.value.memberId,
    courseId: location.course.id,
    completedLessonIds: [],
    updatedAt: now,
  });
};

export interface ResetMemberCourseProgressDeps {
  members: MemberRepository;
  courses: CourseRepository;
  progress: MemberCourseProgressRepository;
  clock: Clock;
}

export interface MemberCourseProgressReset {
  memberId: string;
  courseId: string;
  clearedLessonCount: number;
}

export const resetMemberCourseProgress = async (
  ctx: Ctx,
  input: { memberId: string; courseId: string },
  deps: ResetMemberCourseProgressDeps,
): Promise<Result<MemberCourseProgressReset, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:progress:manage');
  if (!tenant.ok) return tenant;
  if (!input.memberId) return err(validation('memberId is required'));
  if (!input.courseId) return err(validation('courseId is required'));

  const [member, course] = await Promise.all([
    deps.members.findById(tenant.value, input.memberId),
    deps.courses.findById(tenant.value, input.courseId),
  ]);
  const liveMember = requireLiveMember(member, input.memberId);
  if (!liveMember.ok) return liveMember;
  if (!course) return err(notFound(`No course "${input.courseId}" in this tenant`));

  const current = await deps.progress.findByMemberAndCourse(tenant.value, {
    memberId: liveMember.value.id,
    courseId: course.id,
  });
  if (!current) {
    return ok({ memberId: liveMember.value.id, courseId: course.id, clearedLessonCount: 0 });
  }

  const cleared: MemberCourseProgress = {
    id: current.id,
    tenantId: current.tenantId,
    memberId: current.memberId,
    courseId: current.courseId,
    completedLessonIds: [],
    updatedAt: deps.clock.nowIso(),
  };
  const saved = await deps.progress.update(tenant.value, cleared);
  if (!saved) return err(notFound('Progress row vanished while updating'));
  return ok({
    memberId: liveMember.value.id,
    courseId: course.id,
    clearedLessonCount: current.completedLessonIds.length,
  });
};

export const updateLastViewed = async (
  ctx: Ctx,
  input: UpdateLastViewedInput,
  deps: ProgressDeps,
): Promise<Result<MemberCourseProgress, AppError>> => {
  const scope = requireMember(ctx, 'member:progress:self-write');
  if (!scope.ok) return scope;
  const parsed = updateLastViewedInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid last-viewed update', parsed.error.flatten()));

  const course = await deps.courses.findById(scope.value.tenantId, parsed.data.courseId);
  if (!course) return err(notFound(`No course "${parsed.data.courseId}" in this tenant`));

  return ok(await deps.progress.setLastViewed(scope.value.tenantId, {
    id: deps.ids.nextId(),
    memberId: scope.value.memberId,
    courseId: course.id,
    ...(parsed.data.lessonId === undefined ? {} : { lessonId: parsed.data.lessonId }),
    ...(parsed.data.moduleId === undefined ? {} : { moduleId: parsed.data.moduleId }),
    ...(parsed.data.chapterId === undefined ? {} : { chapterId: parsed.data.chapterId }),
    now: deps.clock.nowIso(),
  }));
};

export const getProgress = async (
  ctx: Ctx,
  courseId: string,
  deps: Pick<ProgressDeps, 'progress' | 'courses' | 'modules' | 'grants' | 'clock'> & {
    lessons: Pick<CourseLessonRepository, 'list'>;
  },
): Promise<Result<ProgressView, AppError>> => {
  const scope = requireMember(ctx, 'member:progress:read');
  if (!scope.ok) return scope;
  if (!courseId) return err(validation('courseId is required'));

  const existing = await deps.progress.findByMemberAndCourse(scope.value.tenantId, {
    memberId: scope.value.memberId,
    courseId,
  });
  const course = await deps.courses.findById(scope.value.tenantId, courseId);
  const completedLessonIds = existing?.completedLessonIds ?? [];
  let resume: CourseResume = { target: null, firstIncomplete: null, isReview: false };
  if (course !== null) {
    const [modules, lessons, lookup] = await Promise.all([
      deps.modules.list(scope.value.tenantId),
      deps.lessons.list(scope.value.tenantId),
      ctx.identity.staffRole === null
        ? resolveMemberAccessLookup(scope.value, deps)
        : fullCourseLookup(course.id),
    ]);
    const structure = buildCourseStructure(
      course, modules, new Map(lessons.map((lesson) => [lesson.id, lesson])),
      lookup, new Set(completedLessonIds),
    );
    resume = resolveCourseResume(structure, existing?.lastViewedLessonId);
  }

  return ok({
    courseId,
    completedLessonIds,
    lastViewedLessonId: existing?.lastViewedLessonId,
    lastViewedModuleId: existing?.lastViewedModuleId,
    lastViewedChapterId: existing?.lastViewedChapterId,
    resume,
  });
};
