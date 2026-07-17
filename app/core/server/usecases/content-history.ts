import {
  err,
  forbidden,
  notFound,
  ok,
  readSnapshot,
  tenantNotFound,
  validation,
  type AppError,
  courseHistoryQuerySchema,
  type CourseHistoryEntry,
  type EntityVersionDetail,
  type Result,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  CourseModuleRepository,
  CourseRepository,
  EntityVersionRepository,
  UserDisplayReader,
} from '../ports.js';

export interface ContentHistoryDeps {
  entityVersions: EntityVersionRepository;
  courses: CourseRepository;
  modules: CourseModuleRepository;
  userDisplays: UserDisplayReader;
}

const requireStaffTenant = (ctx: Ctx): Result<string, AppError> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to read content history'));
  if (!ctx.identity.staffRole) return err(forbidden('Only tenant staff can read content history'));
  return ok(ctx.identity.tenantId);
};

/** Lists course and attached-module snapshots newest first, capped by `limit`. */
export const getContentHistory = async (
  ctx: Ctx,
  input: unknown,
  deps: ContentHistoryDeps,
): Promise<Result<CourseHistoryEntry[], AppError>> => {
  const tenant = requireStaffTenant(ctx);
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
  const creatorNames = await deps.userDisplays.findDisplayNames(creatorIds);
  return ok(
    merged.map((version) => ({
      ...version,
      subjectKind: version.entityKind === 'course' ? 'course' : 'module',
      subjectName:
        version.entityKind === 'course'
          ? course.name
          : (moduleNames.get(version.entityId) ?? version.entityId),
      createdByDisplayName:
        version.createdBy === null ? null : (creatorNames.get(version.createdBy) ?? null),
    })),
  );
};

/** Fetches one stored version and upcasts its payload to the current schema. */
export const getContentVersion = async (
  ctx: Ctx,
  versionId: string,
  deps: ContentHistoryDeps,
): Promise<Result<EntityVersionDetail, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;
  if (versionId.length === 0) return err(validation('Missing version id'));

  const record = await deps.entityVersions.findById(tenant.value, versionId);
  if (!record) return err(notFound(`No version "${versionId}" in this tenant`));

  const read = readSnapshot(record.entityKind, {
    schemaVersion: record.schemaVersion,
    payload: record.payload,
  });
  if (!read.ok) return read;

  return ok({
    id: record.id,
    entityKind: record.entityKind,
    entityId: record.entityId,
    schemaVersion: record.schemaVersion,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    currentSchemaVersion: read.value.schemaVersion,
    payload: read.value.payload,
  });
};
