import {
  appError,
  err,
  ok,
  validation,
  type AppError,
  type CourseModule,
  type ImportKind,
  type ImportModuleRecord,
  type Result,
} from '#core/domain/index.js';

import type {
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
} from '../ports.js';

export type ImportReferenceMaps = Record<ImportKind, Map<string, string>> & {
  resolved: Map<string, { inCall: string | undefined; result: Promise<Result<string, AppError>> }>;
  modulesByCourse: Map<string, Promise<Map<string, CourseModule[]>>>;
  forwardModulesByCourse: Map<string, ImportModuleRecord[]> | undefined;
  progressCourses: Map<string, Promise<{
    modules: CourseModule[];
    inCallModules: ImportModuleRecord[];
    lessonIds: Set<string>;
  }>>;
};

export const emptyImportReferenceMaps = (): ImportReferenceMaps => ({
  course: new Map(),
  module: new Map(),
  lesson: new Map(),
  product: new Map(),
  member: new Map(),
  grant: new Map(),
  progress: new Map(),
  redirect: new Map(),
  resolved: new Map(),
  modulesByCourse: new Map(),
  forwardModulesByCourse: undefined,
  progressCourses: new Map(),
});

export const checkImportCreatedAt = (record: object, now: string): Result<void, AppError> =>
  'createdAt' in record && typeof record.createdAt === 'string'
    && Date.parse(record.createdAt) > Date.parse(now) + 300_000
    ? err(validation('createdAt must not be more than 5 minutes in the future', {
        fieldErrors: { createdAt: ['Must not be more than 5 minutes in the future'] },
      }))
    : ok(undefined);

export const memoizeImportRead = <Args extends string[], Value>(
  read: (...args: Args) => Promise<Value>,
) => {
  const cached = new Map<string, Promise<Value>>();
  return {
    read: (...args: Args): Promise<Value> => {
      const key = JSON.stringify(args);
      let result = cached.get(key);
      if (result === undefined) {
        result = read(...args);
        cached.set(key, result);
      }
      return result;
    },
    invalidate: (...args: Args): void => { cached.delete(JSON.stringify(args)); },
  };
};

type ContentReaders = {
  courses: Pick<CourseRepository, 'findById'>;
  modules: Pick<CourseModuleRepository, 'findById'>;
  lessons: Pick<CourseLessonRepository, 'findById'>;
};

export const cacheImportContentReaders = <Deps extends ContentReaders>(deps: Deps) => {
  const courses = memoizeImportRead(deps.courses.findById);
  const modules = memoizeImportRead(deps.modules.findById);
  const lessons = memoizeImportRead(deps.lessons.findById);
  return {
    deps: {
      ...deps,
      courses: { ...deps.courses, findById: courses.read },
      modules: { ...deps.modules, findById: modules.read },
      lessons: { ...deps.lessons, findById: lessons.read },
    },
    invalidate: (tenantId: string, kind: ImportKind, id: string): void => {
      if (kind === 'course') courses.invalidate(tenantId, id);
      if (kind === 'module') modules.invalidate(tenantId, id);
      if (kind === 'lesson') lessons.invalidate(tenantId, id);
    },
  };
};

const referenceCacheKey = (tenantId: string, kind: ImportKind, key: string): string =>
  JSON.stringify([tenantId, kind, key]);

export const rememberImportReference = (
  tenantId: string,
  kind: ImportKind,
  key: string,
  id: string,
  references: ImportReferenceMaps,
): void => {
  references[kind].set(key, id);
  references.resolved.delete(referenceCacheKey(tenantId, kind, key));
};

export const resolveImportReference = async (
  tenantId: string,
  kind: ImportKind,
  key: string,
  references: ImportReferenceMaps,
  findAudit: () => Promise<{ resourceId: string } | null>,
  findTarget: (id: string) => Promise<{ id: string; archivedAt?: string | null | undefined } | null>,
): Promise<Result<string, AppError>> => {
  const inCall = references[kind].get(key);
  const cacheKey = referenceCacheKey(tenantId, kind, key);
  const cached = references.resolved.get(cacheKey);
  if (cached !== undefined && cached.inCall === inCall) return cached.result;
  const resolve = async (): Promise<Result<string, AppError>> => {
    const id = inCall ?? (await findAudit())?.resourceId;
    if (id !== undefined) {
      const target = await findTarget(id);
      if (kind === 'course' && target?.archivedAt) {
        return err(appError('conflict', `Referenced course "${key}" is archived`));
      }
      if (inCall !== undefined || target !== null) return ok(id);
    }
    return err(appError('conflict', `Referenced ${kind} "${key}" was not created by import`));
  };
  const result = resolve();
  references.resolved.set(cacheKey, { inCall, result });
  return result;
};
