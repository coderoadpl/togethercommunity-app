import { err, ok, validation, type AccessItem, type AppError, type CourseModule, type Result } from '#core/domain/index.js';

import type { CourseLessonIdLookup, CourseModuleRepository, CourseRepository } from '../ports.js';

export interface ProductAccessCatalog {
  courses: Pick<CourseRepository, 'findByIds'>;
  modules: Pick<CourseModuleRepository, 'findByIds' | 'list'>;
  lessons: CourseLessonIdLookup;
}

export const PRODUCT_ACCESS_COURSE_MESSAGE = 'Product access items may only reference existing, active courses';

export const PRODUCT_ACCESS_KEY_REFUSAL =
  'Product access items may only reference active courses of this workspace, and modules and lessons that belong to the item courseId';

/** A submission must not tell its key whether a course, module or lesson exists or where it sits: no route serves the key those. */
export type ProductAccessCheck = 'now' | 'at-approval';

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

const lessonsReachedBy = (modules: readonly CourseModule[], courseId: string): Set<string> => new Set(modules
  .filter((module) => module.courseIds.includes(courseId))
  .flatMap((module) => module.chapters.flatMap((chapter) => chapter.contents.map((content) => content.lessonId))));

const moduleIdsOf = (item: AccessItem): string[] => {
  switch (item.level) {
    case 'course':
      return item.excludedModuleIds ?? [];
    case 'modules':
      return item.moduleIds;
    case 'lessons':
      return [];
  }
};

const lessonIdsOf = (item: AccessItem): string[] => item.level === 'lessons' ? item.lessonIds : [];

const byId = async <T extends { id: string }>(ids: string[], find: (ids: string[]) => Promise<T[]>): Promise<Map<string, T>> =>
  new Map(ids.length === 0 ? [] : (await find(ids)).map((found) => [found.id, found]));

const checkModules = (
  moduleIds: readonly string[],
  courseId: string,
  outsideCourseMessage: string,
  modulesById: ReadonlyMap<string, CourseModule>,
): Result<void, AppError> => {
  const modules = moduleIds.flatMap((id) => modulesById.get(id) ?? []);
  if (modules.length !== moduleIds.length) return err(validation('Product access items may only reference existing modules'));
  return modules.every((module) => module.courseIds.includes(courseId)) ? ok(undefined) : err(validation(outsideCourseMessage));
};

// A module or lesson item still opens that module or lesson wherever it is used; checking it against the item's course
// only keeps the course the owner reads next to it true.
export const checkProductAccessItems = async (
  tenantId: string,
  items: readonly AccessItem[],
  catalog: ProductAccessCatalog,
): Promise<Result<void, AppError>> => {
  const courseIds = unique(items.map((item) => item.courseId));
  if (courseIds.length === 0) return ok(undefined);
  const courses = await catalog.courses.findByIds(tenantId, courseIds);
  if (courses.length !== courseIds.length || courses.some((course) => course.archivedAt)) {
    return err(validation(PRODUCT_ACCESS_COURSE_MESSAGE));
  }
  const modulesById = await byId(unique(items.flatMap(moduleIdsOf)), (ids) => catalog.modules.findByIds(tenantId, ids));
  const namedLessonIds = unique(items.flatMap(lessonIdsOf));
  const existingLessonIds = new Set(namedLessonIds.length === 0 ? [] : await catalog.lessons.existingIds(tenantId, namedLessonIds));
  const tenantModules = existingLessonIds.size === 0 ? [] : await catalog.modules.list(tenantId);
  const reachedByCourse = new Map<string, Set<string>>();
  const reachedBy = (courseId: string): Set<string> => {
    const known = reachedByCourse.get(courseId);
    if (known !== undefined) return known;
    const reached = lessonsReachedBy(tenantModules, courseId);
    reachedByCourse.set(courseId, reached);
    return reached;
  };
  for (const item of items) {
    if (item.level === 'modules') {
      const modules = checkModules(unique(item.moduleIds), item.courseId, 'Product access moduleIds must belong to the item courseId', modulesById);
      if (!modules.ok) return modules;
    } else if (item.level === 'course') {
      const excluded = checkModules(
        unique(item.excludedModuleIds ?? []), item.courseId, 'Product access excludedModuleIds must belong to the item courseId', modulesById,
      );
      if (!excluded.ok) return excluded;
    } else {
      const lessonIds = unique(item.lessonIds);
      if (!lessonIds.every((lessonId) => existingLessonIds.has(lessonId))) return err(validation('Product access items may only reference existing lessons'));
      const reached = reachedBy(item.courseId);
      if (!lessonIds.every((lessonId) => reached.has(lessonId))) {
        return err(validation('Product access lessonIds must belong to the item courseId through its modules and chapters'));
      }
    }
  }
  return ok(undefined);
};
