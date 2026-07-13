import {
  attachModuleToCourseInputSchema,
  computeCourseModuleName,
  err,
  forbidden,
  newCourseLessonSchema,
  newCourseModuleSchema,
  newCourseSchema,
  notFound,
  ok,
  tenantNotFound,
  updateCourseInputSchema,
  updateCourseLessonInputSchema,
  updateCourseModuleInputSchema,
  updateProductAccessItemsInputSchema,
  validation,
  type AppError,
  type Chapter,
  type Course,
  type CourseLesson,
  type CourseModule,
  type Product,
  type Result,
  type UpdateProductAccessItemsInput,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  IdGenerator,
  ProductRepository,
} from '../ports.js';

export interface CourseManagementDeps {
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: CourseLessonRepository;
  products: ProductRepository;
  ids: IdGenerator;
  clock: Clock;
}

const requireStaffTenant = (ctx: Ctx): Result<string, AppError> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to manage courses'));
  if (!ctx.identity.staffRole) return err(forbidden('Only tenant staff can manage courses'));
  return ok(ctx.identity.tenantId);
};

const unique = (ids: string[]): string[] => [...new Set(ids)];

const lessonIdsInChapters = (chapters: Chapter[]): string[] =>
  unique(chapters.flatMap((chapter) => chapter.contents.map((content) => content.lessonId)));

const validateCourseIds = async (
  tenantId: string,
  courseIds: string[],
  deps: Pick<CourseManagementDeps, 'courses'>,
): Promise<Result<void, AppError>> => {
  const ids = unique(courseIds);
  if (ids.length === 0) return ok(undefined);
  const courses = await deps.courses.findByIds(tenantId, ids);
  if (courses.length !== ids.length) return err(validation('Module references unknown courses'));
  return ok(undefined);
};

const validateChapterLessons = async (
  tenantId: string,
  chapters: Chapter[],
  deps: Pick<CourseManagementDeps, 'lessons'>,
): Promise<Result<void, AppError>> => {
  const lessonIds = lessonIdsInChapters(chapters);
  if (lessonIds.length === 0) return ok(undefined);
  const lessons = await deps.lessons.findByIds(tenantId, lessonIds);
  if (lessons.length !== lessonIds.length) {
    return err(validation('Module chapters may only reference lessons from the same tenant'));
  }
  return ok(undefined);
};

export const listCourses = async (
  ctx: Ctx,
  deps: CourseManagementDeps,
): Promise<Result<Course[], AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;
  return ok(await deps.courses.list(tenant.value));
};

export const createCourse = async (
  ctx: Ctx,
  input: unknown,
  deps: CourseManagementDeps,
): Promise<Result<Course, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;
  const parsed = newCourseSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid course', parsed.error.flatten()));

  const course: Course = {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    name: parsed.data.name,
    description: parsed.data.description,
    imageUrl: parsed.data.imageUrl,
    legacyId: parsed.data.legacyId,
    createdAt: deps.clock.nowIso(),
  };
  await deps.courses.create(tenant.value, course);
  return ok(course);
};

export const updateCourse = async (
  ctx: Ctx,
  input: unknown,
  deps: CourseManagementDeps,
): Promise<Result<Course, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;
  const parsed = updateCourseInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid course update', parsed.error.flatten()));

  const existing = await deps.courses.findById(tenant.value, parsed.data.id);
  if (!existing) return err(notFound(`No course "${parsed.data.id}" in this tenant`));

  const updated: Course = {
    ...existing,
    name: parsed.data.name ?? existing.name,
    description: parsed.data.description ?? existing.description,
    imageUrl: parsed.data.imageUrl === undefined ? existing.imageUrl : parsed.data.imageUrl,
  };
  const saved = await deps.courses.update(tenant.value, updated);
  return saved ? ok(saved) : err(notFound(`No course "${parsed.data.id}" in this tenant`));
};

export const createModule = async (
  ctx: Ctx,
  input: unknown,
  deps: CourseManagementDeps,
): Promise<Result<CourseModule, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;
  const parsed = newCourseModuleSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid module', parsed.error.flatten()));

  const courseCheck = await validateCourseIds(tenant.value, parsed.data.courseIds, deps);
  if (!courseCheck.ok) return courseCheck;
  const lessonCheck = await validateChapterLessons(tenant.value, parsed.data.chapters, deps);
  if (!lessonCheck.ok) return lessonCheck;

  const module: CourseModule = {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    courseIds: unique(parsed.data.courseIds),
    title: parsed.data.title,
    prefix: parsed.data.prefix,
    name: computeCourseModuleName(parsed.data.prefix, parsed.data.title),
    chapters: parsed.data.chapters,
    legacyId: parsed.data.legacyId,
    createdAt: deps.clock.nowIso(),
  };
  await deps.modules.create(tenant.value, module);
  return ok(module);
};

export const updateModule = async (
  ctx: Ctx,
  input: unknown,
  deps: CourseManagementDeps,
): Promise<Result<CourseModule, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;
  const parsed = updateCourseModuleInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid module update', parsed.error.flatten()));

  const existing = await deps.modules.findById(tenant.value, parsed.data.id);
  if (!existing) return err(notFound(`No module "${parsed.data.id}" in this tenant`));

  if (parsed.data.chapters) {
    const lessonCheck = await validateChapterLessons(tenant.value, parsed.data.chapters, deps);
    if (!lessonCheck.ok) return lessonCheck;
  }

  const title = parsed.data.title ?? existing.title;
  const prefix = parsed.data.prefix === undefined ? existing.prefix : parsed.data.prefix;
  const updated: CourseModule = {
    ...existing,
    title,
    prefix,
    name: computeCourseModuleName(prefix, title),
    chapters: parsed.data.chapters ?? existing.chapters,
  };
  const saved = await deps.modules.update(tenant.value, updated);
  return saved ? ok(saved) : err(notFound(`No module "${parsed.data.id}" in this tenant`));
};

export const createLesson = async (
  ctx: Ctx,
  input: unknown,
  deps: CourseManagementDeps,
): Promise<Result<CourseLesson, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;
  const parsed = newCourseLessonSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid lesson', parsed.error.flatten()));

  const lesson: CourseLesson = {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    name: parsed.data.name,
    contents: parsed.data.contents,
    legacyId: parsed.data.legacyId,
    createdAt: deps.clock.nowIso(),
  };
  await deps.lessons.create(tenant.value, lesson);
  return ok(lesson);
};

export const updateLesson = async (
  ctx: Ctx,
  input: unknown,
  deps: CourseManagementDeps,
): Promise<Result<CourseLesson, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;
  const parsed = updateCourseLessonInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid lesson update', parsed.error.flatten()));

  const existing = await deps.lessons.findById(tenant.value, parsed.data.id);
  if (!existing) return err(notFound(`No lesson "${parsed.data.id}" in this tenant`));

  const updated: CourseLesson = {
    ...existing,
    name: parsed.data.name ?? existing.name,
    contents: parsed.data.contents ?? existing.contents,
  };
  const saved = await deps.lessons.update(tenant.value, updated);
  return saved ? ok(saved) : err(notFound(`No lesson "${parsed.data.id}" in this tenant`));
};

export const attachModuleToCourse = async (
  ctx: Ctx,
  input: unknown,
  deps: CourseManagementDeps,
): Promise<Result<CourseModule, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;
  const parsed = attachModuleToCourseInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid module attachment', parsed.error.flatten()));

  const course = await deps.courses.findById(tenant.value, parsed.data.courseId);
  if (!course) return err(notFound(`No course "${parsed.data.courseId}" in this tenant`));
  const module = await deps.modules.findById(tenant.value, parsed.data.moduleId);
  if (!module) return err(notFound(`No module "${parsed.data.moduleId}" in this tenant`));
  if (module.courseIds.includes(course.id)) return ok(module);

  const updated: CourseModule = { ...module, courseIds: [...module.courseIds, course.id] };
  const saved = await deps.modules.update(tenant.value, updated);
  return saved ? ok(saved) : err(notFound(`No module "${parsed.data.moduleId}" in this tenant`));
};

export const updateProductAccessItems = async (
  ctx: Ctx,
  input: UpdateProductAccessItemsInput,
  deps: CourseManagementDeps,
): Promise<Result<Product, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;
  const parsed = updateProductAccessItemsInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid product access items', parsed.error.flatten()));

  const product = await deps.products.findById(tenant.value, parsed.data.id);
  if (!product) return err(notFound(`No product "${parsed.data.id}" in this tenant`));

  const courseIds = unique(parsed.data.accessItems.map((item) => item.courseId));
  const courses = await deps.courses.findByIds(tenant.value, courseIds);
  if (courses.length !== courseIds.length) {
    return err(validation('Product access items may only reference existing courses'));
  }

  for (const item of parsed.data.accessItems) {
    const modules = await deps.modules.findByIds(tenant.value, unique(item.moduleIds));
    if (modules.length !== unique(item.moduleIds).length) {
      return err(validation('Product access items may only reference existing modules'));
    }
    if (modules.some((module) => !module.courseIds.includes(item.courseId))) {
      return err(validation('Product access moduleIds must belong to the item courseId'));
    }

    const lessonIds = unique(item.lessonIds);
    const lessons = await deps.lessons.findByIds(tenant.value, lessonIds);
    if (lessons.length !== lessonIds.length) {
      return err(validation('Product access items may only reference existing lessons'));
    }
  }

  const updated = await deps.products.updateAccessItems(tenant.value, product.id, parsed.data.accessItems);
  return updated ? ok(updated) : err(notFound(`No product "${parsed.data.id}" in this tenant`));
};
