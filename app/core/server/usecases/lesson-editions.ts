import {
  appError, buildSnapshot, currentSnapshotParsers, err, lessonEditionNumberSchema,
  markLessonEditionInputSchema, notFound, ok, readSnapshot, snapshotPayloadsEqual, unmarkLessonEditionInputSchema, validation,
  type AppError, type CourseLesson, type LessonEdition, type ReaderLessonEdition, type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { Clock, CourseLessonRepository, EntityVersionRecord, EntityVersionRepository, IdGenerator, LessonEditionRepository } from '../ports.js';
import { getAccessibleLesson, type CourseAccessDeps } from './entitlements.js';

export interface LessonEditionReadDeps extends CourseAccessDeps {
  lessonEditions: LessonEditionRepository;
}
export interface LessonEditionWriteDeps {
  lessonEditions: LessonEditionRepository;
  entityVersions: EntityVersionRepository;
  lessons: Pick<CourseLessonRepository, 'findById'>;
  ids: IdGenerator;
  clock: Clock;
}

export const listLessonEditions = async (
  ctx: Ctx, lessonId: string, deps: LessonEditionReadDeps,
): Promise<Result<ReaderLessonEdition[], AppError>> => {
  const tenant = authorizeTenant(ctx, 'lesson:play');
  if (!tenant.ok) return tenant;
  const lesson = await getAccessibleLesson(ctx, lessonId, deps);
  if (!lesson.ok) return lesson;
  const editions = await deps.lessonEditions.list(tenant.value, lessonId);
  return ok(editions.map(({ number, note, markedAt }) => ({ number, note, markedAt })));
};

export const getLessonEdition = async (
  ctx: Ctx, lessonId: string, number: string, deps: LessonEditionReadDeps,
): Promise<Result<CourseLesson, AppError>> => {
  const tenant = authorizeTenant(ctx, 'lesson:play');
  if (!tenant.ok) return tenant;
  const lesson = await getAccessibleLesson(ctx, lessonId, deps);
  if (!lesson.ok) return lesson;
  const parsed = lessonEditionNumberSchema.safeParse(number);
  if (!parsed.success) return err(validation('Invalid edition number'));
  const version = await deps.lessonEditions.find(tenant.value, lessonId, parsed.data);
  if (version === null) return err(notFound('Lesson edition not found'));
  const snapshot = readSnapshot('course_lesson', version);
  if (!snapshot.ok) return snapshot;
  const content = currentSnapshotParsers.course_lesson(snapshot.value.payload);
  return ok({ ...lesson.value, name: content.name, contents: content.contents, durationMinutes: content.durationMinutes });
};

export const markLessonEdition = async (
  ctx: Ctx, input: unknown, deps: LessonEditionWriteDeps,
): Promise<Result<LessonEdition, AppError>> => {
  const tenant = authorizeTenant(ctx, 'course:write');
  if (!tenant.ok) return tenant;
  const parsed = markLessonEditionInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid lesson edition', parsed.error.flatten()));
  const lesson = await deps.lessons.findById(tenant.value, parsed.data.lessonId);
  if (lesson === null) return err(notFound('Lesson not found'));
  const snapshot = buildSnapshot('course_lesson', lesson);
  if (!snapshot.ok) return snapshot;
  let version: EntityVersionRecord | null;
  if (parsed.data.versionId === undefined) {
    const [latest] = await deps.entityVersions.list(tenant.value, {
      entityKind: 'course_lesson', entityId: lesson.id, limit: 1,
    });
    const stored = latest === undefined ? null : await deps.entityVersions.findById(tenant.value, latest.id);
    version = stored !== null && stored.schemaVersion === snapshot.value.schemaVersion &&
      (stored.edition == null || stored.edition.number === parsed.data.edition.number) &&
      snapshotPayloadsEqual(stored.payload, snapshot.value.payload) ? stored : {
        id: deps.ids.nextId(), entityKind: 'course_lesson', entityId: lesson.id,
        schemaVersion: snapshot.value.schemaVersion, payload: snapshot.value.payload,
        createdAt: deps.clock.nowIso(), createdBy: ctx.identity.userId,
      };
  } else {
    version = await deps.entityVersions.findById(tenant.value, parsed.data.versionId);
  }
  if (version === null || version.entityKind !== 'course_lesson' || version.entityId !== lesson.id) {
    return err(notFound('Lesson version not found'));
  }
  const marked = await deps.lessonEditions.mark(tenant.value, version, parsed.data.edition, deps.clock.nowIso());
  return marked === 'conflict' ? err(appError('conflict', 'Edition number already exists for this lesson')) : ok(marked);
};

export const unmarkLessonEdition = async (
  ctx: Ctx, input: unknown, deps: LessonEditionWriteDeps,
): Promise<Result<void, AppError>> => {
  const tenant = authorizeTenant(ctx, 'course:write');
  if (!tenant.ok) return tenant;
  const parsed = unmarkLessonEditionInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid lesson edition', parsed.error.flatten()));
  return await deps.lessonEditions.unmark(tenant.value, parsed.data.lessonId, parsed.data.number)
    ? ok(undefined) : err(notFound('Lesson edition not found'));
};
