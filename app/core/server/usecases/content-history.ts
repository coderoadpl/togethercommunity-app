import {
  buildVersionPreview,
  changedPreviewFields,
  currentSnapshotParsers,
  err,
  notFound,
  ok,
  readSnapshot,
  restoreContentVersionInputSchema,
  validation,
  type AppError,
  type ContentVersionRestore,
  type CourseHistoryEntry,
  type EntityKind,
  type EntityVersionDetail,
  type Result,
  type VersionPreview,
  type VersionPreviewFieldName,
  courseHistoryQuerySchema,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type {
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  EntityVersionRepository,
  ProductRepository,
  TenantAuditEventRepository,
  UserDisplayReader,
} from '../ports.js';
import {
  updateCourse,
  updateLesson,
  updateModule,
  type CourseManagementDeps,
} from './course-management.js';
import { updateProduct, type ProductUpdateDeps } from './products.js';

export interface ContentHistoryDeps {
  entityVersions: EntityVersionRepository;
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: Pick<CourseLessonRepository, 'findById'>;
  products: Pick<ProductRepository, 'findById'>;
  userDisplays: UserDisplayReader;
}

export type ContentRestoreDeps = ContentHistoryDeps &
  CourseManagementDeps &
  ProductUpdateDeps & { auditEvents: Pick<TenantAuditEventRepository, 'record'> };

export interface ContentVersionView {
  version: EntityVersionDetail;
  preview: VersionPreview;
  current: VersionPreview | null;
  changedFields: VersionPreviewFieldName[];
}

/**
 * The import stamps a key label rather than a user id, so a value the display
 * lookup cannot resolve is still the best available author name.
 */
const authorName = (createdBy: string | null, names: Map<string, string>): string | null =>
  createdBy === null ? null : (names.get(createdBy) ?? createdBy);

/** Lists course and attached-module snapshots newest first, capped by `limit`. */
export const getContentHistory = async (
  ctx: Ctx,
  input: unknown,
  deps: ContentHistoryDeps,
): Promise<Result<CourseHistoryEntry[], AppError>> => {
  const tenant = authorizeTenant(ctx, 'course:history:read');
  if (!tenant.ok) return tenant;
  const parsed = courseHistoryQuerySchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid history query', parsed.error.flatten()));
  const [course, modules] = await Promise.all([
    deps.courses.findById(tenant.value, parsed.data.courseId),
    deps.modules.list(tenant.value),
  ]);
  if (!course) return err(notFound(`No course "${parsed.data.courseId}" in this tenant`));

  const courseModules = modules.filter((module) => module.courseIds.includes(course.id));
  const versionLists = await Promise.all([
    deps.entityVersions.list(tenant.value, {
      entityKind: 'course',
      entityId: course.id,
      limit: parsed.data.limit,
    }),
    ...courseModules.map((module) =>
      deps.entityVersions.list(tenant.value, {
        entityKind: 'course_module',
        entityId: module.id,
        limit: parsed.data.limit,
      }),
    ),
  ]);
  const moduleNames = new Map(courseModules.map((module) => [module.id, module.name]));
  const merged = versionLists
    .flat()
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .slice(0, parsed.data.limit);
  const creatorIds = [
    ...new Set(merged.flatMap((version) => (version.createdBy === null ? [] : [version.createdBy]))),
  ];
  const creatorNames = await deps.userDisplays.findDisplayNames(tenant.value, creatorIds);
  return ok(
    merged.map((version) => ({
      ...version,
      subjectKind: version.entityKind === 'course' ? 'course' : 'module',
      subjectName:
        version.entityKind === 'course'
          ? course.name
          : (moduleNames.get(version.entityId) ?? version.entityId),
      createdByDisplayName: authorName(version.createdBy, creatorNames),
    })),
  );
};

const liveEntity = async (
  tenantId: string,
  kind: EntityKind,
  entityId: string,
  deps: ContentHistoryDeps,
): Promise<unknown> => {
  if (kind === 'course') return deps.courses.findById(tenantId, entityId);
  if (kind === 'course_module') return deps.modules.findById(tenantId, entityId);
  if (kind === 'course_lesson') return deps.lessons.findById(tenantId, entityId);
  return deps.products.findById(tenantId, entityId);
};

const moduleNamesFor = async (
  tenantId: string,
  kind: EntityKind,
  deps: ContentHistoryDeps,
): Promise<Map<string, string>> => {
  if (kind !== 'course') return new Map();
  const modules = await deps.modules.list(tenantId);
  return new Map(modules.map((module) => [module.id, module.name]));
};

/**
 * Fetches one stored version, upcasts its payload to the current schema and
 * renders both it and the live entity as edit-form previews so the caller can
 * highlight the fields the restore would change.
 */
export const getContentVersion = async (
  ctx: Ctx,
  versionId: string,
  deps: ContentHistoryDeps,
): Promise<Result<ContentVersionView, AppError>> => {
  const tenant = authorizeTenant(ctx, 'course:history:read');
  if (!tenant.ok) return tenant;
  if (versionId.length === 0) return err(validation('Missing version id'));

  const record = await deps.entityVersions.findById(tenant.value, versionId);
  if (!record) return err(notFound(`No version "${versionId}" in this tenant`));

  const read = readSnapshot(record.entityKind, {
    schemaVersion: record.schemaVersion,
    payload: record.payload,
  });
  if (!read.ok) return read;

  const moduleNames = await moduleNamesFor(tenant.value, record.entityKind, deps);
  const preview = buildVersionPreview(record.entityKind, read.value.payload, moduleNames);
  if (!preview.ok) return preview;

  const creatorNames = await deps.userDisplays.findDisplayNames(
    tenant.value,
    record.createdBy === null ? [] : [record.createdBy],
  );
  const live = await liveEntity(tenant.value, record.entityKind, record.entityId, deps);
  const current =
    live === null ? null : buildVersionPreview(record.entityKind, live, moduleNames);
  if (current !== null && !current.ok) return current;

  return ok({
    version: {
      id: record.id,
      entityKind: record.entityKind,
      entityId: record.entityId,
      ordinal: record.ordinal,
      schemaVersion: record.schemaVersion,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      createdByDisplayName: authorName(record.createdBy, creatorNames),
      currentSchemaVersion: read.value.schemaVersion,
      payload: read.value.payload,
    },
    preview: preview.value,
    current: current === null ? null : current.value,
    changedFields: current === null ? [] : changedPreviewFields(preview.value, current.value),
  });
};

const restoreCourse = async (
  ctx: Ctx,
  tenantId: string,
  payload: unknown,
  entityId: string,
  deps: ContentRestoreDeps,
): Promise<Result<unknown, AppError>> => {
  const snapshot = currentSnapshotParsers.course(payload);
  const attachedIds = new Set(
    (await deps.modules.list(tenantId))
      .filter((module) => module.courseIds.includes(entityId))
      .map((module) => module.id),
  );
  return updateCourse(
    ctx,
    {
      id: entityId,
      name: snapshot.name,
      description: snapshot.description,
      imageUrl: snapshot.imageUrl,
      publiclyVisible: snapshot.publiclyVisible,
      moduleOrder: snapshot.moduleOrder.filter((moduleId) => attachedIds.has(moduleId)),
    },
    deps,
  );
};

const restoreModule = (
  ctx: Ctx,
  payload: unknown,
  entityId: string,
  deps: ContentRestoreDeps,
): Promise<Result<unknown, AppError>> => {
  const snapshot = currentSnapshotParsers.course_module(payload);
  return updateModule(
    ctx,
    { id: entityId, title: snapshot.title, prefix: snapshot.prefix, chapters: snapshot.chapters },
    deps,
  );
};

const restoreLesson = (
  ctx: Ctx,
  payload: unknown,
  entityId: string,
  deps: ContentRestoreDeps,
): Promise<Result<unknown, AppError>> => {
  const snapshot = currentSnapshotParsers.course_lesson(payload);
  return updateLesson(
    ctx,
    {
      id: entityId,
      name: snapshot.name,
      isPreview: snapshot.isPreview,
      contents: snapshot.contents,
      durationMinutes: snapshot.durationMinutes ?? null,
    },
    deps,
  );
};

const restoreProduct = (
  ctx: Ctx,
  payload: unknown,
  entityId: string,
  deps: ContentRestoreDeps,
): Promise<Result<unknown, AppError>> => {
  const snapshot = currentSnapshotParsers.product(payload);
  return updateProduct(
    ctx,
    {
      id: entityId,
      title: snapshot.title,
      description: snapshot.description,
      coverUrl: snapshot.coverUrl,
    },
    deps,
  );
};

/**
 * Re-applies a stored snapshot through the ordinary update use-cases, so the
 * restore is validated like any other save and appends a new version instead
 * of rewriting the trail.
 */
export const restoreContentVersion = async (
  ctx: Ctx,
  input: unknown,
  deps: ContentRestoreDeps,
): Promise<Result<ContentVersionRestore, AppError>> => {
  const tenant = authorizeTenant(ctx, 'course:history:read');
  if (!tenant.ok) return tenant;
  const parsed = restoreContentVersionInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid restore request', parsed.error.flatten()));

  const record = await deps.entityVersions.findById(tenant.value, parsed.data.versionId);
  if (!record) return err(notFound(`No version "${parsed.data.versionId}" in this tenant`));

  const read = readSnapshot(record.entityKind, {
    schemaVersion: record.schemaVersion,
    payload: record.payload,
  });
  if (!read.ok) return read;

  const applied =
    record.entityKind === 'course'
      ? await restoreCourse(ctx, tenant.value, read.value.payload, record.entityId, deps)
      : record.entityKind === 'course_module'
        ? await restoreModule(ctx, read.value.payload, record.entityId, deps)
        : record.entityKind === 'course_lesson'
          ? await restoreLesson(ctx, read.value.payload, record.entityId, deps)
          : await restoreProduct(ctx, read.value.payload, record.entityId, deps);
  if (!applied.ok) return err(applied.error);

  await deps.auditEvents.record(tenant.value, {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    kind: 'content_version_restored',
    actorUserId: ctx.identity.userId,
    actorEmail: ctx.identity.email,
    subjectMemberId: null,
    reason: `${record.entityKind} ${record.entityId} restored to version ${record.ordinal}`,
    at: deps.clock.nowIso(),
  });

  return ok({
    entityKind: record.entityKind,
    entityId: record.entityId,
    restoredFromVersionId: record.id,
    restoredFromOrdinal: record.ordinal,
  });
};
