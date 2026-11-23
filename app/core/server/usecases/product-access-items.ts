import { err, ok, validation, type AccessItem, type AppError, type CourseModule, type Result } from '#core/domain/index.js';

import type { CourseLessonRepository, CourseModuleRepository, CourseRepository } from '../ports.js';

export interface ProductAccessCatalog {
  courses: Pick<CourseRepository, 'findByIds'>;
  modules: Pick<CourseModuleRepository, 'findByIds' | 'list'>;
  lessons: Pick<CourseLessonRepository, 'findByIds'>;
}

export const PRODUCT_ACCESS_COURSE_MESSAGE = 'Product access items may only reference existing, active courses';

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

const lessonsReachedBy = (modules: readonly CourseModule[], courseId: string): Set<string> => new Set(modules
  .filter((module) => module.courseIds.includes(courseId))
  .flatMap((module) => module.chapters.flatMap((chapter) => chapter.contents.map((content) => content.lessonId))));

const checkModules = async (
  tenantId: string,
  moduleIds: readonly string[],
  courseId: string,
  outsideCourseMessage: string,
  catalog: ProductAccessCatalog,
): Promise<Result<void, AppError>> => {
  if (moduleIds.length === 0) return ok(undefined);
  const modules = await catalog.modules.findByIds(tenantId, [...moduleIds]);
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
  let tenantModules: CourseModule[] | null = null;
  for (const item of items) {
    if (item.level === 'modules') {
      const modules = await checkModules(tenantId, unique(item.moduleIds), item.courseId, 'Product access moduleIds must belong to the item courseId', catalog);
      if (!modules.ok) return modules;
    } else if (item.level === 'course') {
      const excluded = await checkModules(
        tenantId, unique(item.excludedModuleIds ?? []), item.courseId, 'Product access excludedModuleIds must belong to the item courseId', catalog,
      );
      if (!excluded.ok) return excluded;
    } else {
      const lessonIds = unique(item.lessonIds);
      const lessons = await catalog.lessons.findByIds(tenantId, lessonIds);
      if (lessons.length !== lessonIds.length) return err(validation('Product access items may only reference existing lessons'));
      tenantModules ??= await catalog.modules.list(tenantId);
      const reached = lessonsReachedBy(tenantModules, item.courseId);
      if (!lessonIds.every((lessonId) => reached.has(lessonId))) {
        return err(validation('Product access lessonIds must belong to the item courseId through its modules and chapters'));
      }
    }
  }
  return ok(undefined);
};

const PROPOSED_EXCLUSION_MESSAGE = 'This module cannot be excluded through a proposal';

// Access resolution pools the excluded modules of every course item, so excluding a module that other courses also use
// closes it there too; until exclusions are per course, a proposal that replaces a live list may not write one.
export const checkProposedAccessExclusions = async (
  tenantId: string,
  items: readonly AccessItem[],
  catalog: Pick<ProductAccessCatalog, 'modules'>,
): Promise<Result<void, AppError>> => {
  const excluded = unique(items.flatMap((item) => item.level === 'course' ? item.excludedModuleIds ?? [] : []));
  if (excluded.length === 0) return ok(undefined);
  const modules = await catalog.modules.findByIds(tenantId, excluded);
  return modules.some((module) => unique(module.courseIds).length > 1)
    ? err(validation('Product access excludedModuleIds: this module cannot be excluded through a proposal', {
      formErrors: [],
      fieldErrors: { excludedModuleIds: [PROPOSED_EXCLUSION_MESSAGE] },
    }))
    : ok(undefined);
};
