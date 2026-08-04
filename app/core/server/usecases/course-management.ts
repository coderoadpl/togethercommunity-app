import {
  attachModuleToCourseInputSchema,
  buildSnapshot,
  computeCourseModuleName,
  deleteCourseLessonInputSchema,
  detachModuleFromCourseInputSchema,
  err,
  newCourseLessonSchema,
  newCourseModuleSchema,
  newCourseSchema,
  notFound,
  ok,
  updateCourseInputSchema,
  updateCourseLessonInputSchema,
  updateCourseModuleInputSchema,
  updateProductAccessItemsInputSchema,
  validation,
  type AccessItem,
  type AppError,
  type Chapter,
  type Capability,
  type Course,
  type CourseLesson,
  type CourseModule,
  type EntityKind,
  type LessonReferenceChapter,
  type LessonReferenceProduct,
  type LessonReferences,
  type Product,
  type Result,
  type UpdateProductAccessItemsInput,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type {
  Clock,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  EntityVersionRecord,
  IdGenerator,
  LessonAttachmentRepository,
  MemberCourseProgressRepository,
  ProductRepository,
  StorageProvider,
  TenantSecretResolver,
} from '../ports.js';
import { deleteLessonAttachmentObjects } from './lesson-attachments.js';

export interface CourseManagementDeps {
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: CourseLessonRepository;
  products: ProductRepository;
  progress: MemberCourseProgressRepository;
  attachments: LessonAttachmentRepository;
  storage: StorageProvider;
  secretResolver: TenantSecretResolver;
  ids: IdGenerator;
  clock: Clock;
}

const requireStaffTenant = (ctx: Ctx, capability: Capability): Result<string, AppError> =>
  authorizeTenant(ctx, capability);

/**
 * Builds the previous-state snapshot the write-through path persists in the
 * same transaction as the update. Failure means the live entity no longer
 * matches the current snapshot schema — the versioning gate should have caught
 * that, so we surface it rather than silently skip the snapshot.
 */
const snapshotOf = (
  ctx: Ctx,
  kind: EntityKind,
  entityId: string,
  previous: unknown,
  deps: Pick<CourseManagementDeps, 'ids' | 'clock'>,
): Result<EntityVersionRecord, AppError> => {
  const built = buildSnapshot(kind, previous);
  if (!built.ok) return built;
  return ok({
    id: deps.ids.nextId(),
    entityKind: kind,
    entityId,
    schemaVersion: built.value.schemaVersion,
    payload: built.value.payload,
    createdAt: deps.clock.nowIso(),
    createdBy: ctx.identity.userId,
  });
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
  const tenant = requireStaffTenant(ctx, 'course:read');
  if (!tenant.ok) return tenant;
  return ok(await deps.courses.list(tenant.value));
};

export const listModules = async (
  ctx: Ctx,
  deps: CourseManagementDeps,
): Promise<Result<CourseModule[], AppError>> => {
  const tenant = requireStaffTenant(ctx, 'course:read');
  if (!tenant.ok) return tenant;
  return ok(await deps.modules.list(tenant.value));
};

export const listLessons = async (
  ctx: Ctx,
  deps: CourseManagementDeps,
): Promise<Result<CourseLesson[], AppError>> => {
  const tenant = requireStaffTenant(ctx, 'course:read');
  if (!tenant.ok) return tenant;
  return ok(await deps.lessons.list(tenant.value));
};

export const createCourse = async (
  ctx: Ctx,
  input: unknown,
  deps: CourseManagementDeps,
): Promise<Result<Course, AppError>> => {
  const tenant = requireStaffTenant(ctx, 'course:write');
  if (!tenant.ok) return tenant;
  const parsed = newCourseSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid course', parsed.error.flatten()));

  const course: Course = {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    name: parsed.data.name,
    description: parsed.data.description,
    imageUrl: parsed.data.imageUrl,
    moduleOrder: [],
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
  const tenant = requireStaffTenant(ctx, 'course:write');
  if (!tenant.ok) return tenant;
  const parsed = updateCourseInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid course update', parsed.error.flatten()));

  const existing = await deps.courses.findById(tenant.value, parsed.data.id);
  if (!existing) return err(notFound(`No course "${parsed.data.id}" in this tenant`));

  let moduleOrder = existing.moduleOrder;
  if (parsed.data.moduleOrder !== undefined) {
    const requested = unique(parsed.data.moduleOrder);
    if (requested.length !== parsed.data.moduleOrder.length) {
      return err(validation('Module order may not contain duplicate module ids'));
    }
    const attached = (await deps.modules.list(tenant.value)).filter((module) =>
      module.courseIds.includes(existing.id),
    );
    const attachedIds = new Set(attached.map((module) => module.id));
    if (requested.some((moduleId) => !attachedIds.has(moduleId))) {
      return err(validation('Module order may only reference modules attached to this course'));
    }
    const requestedSet = new Set(requested);
    const trailing = attached.filter((module) => !requestedSet.has(module.id)).map((module) => module.id);
    moduleOrder = [...requested, ...trailing];
  }

  const snapshot = snapshotOf(ctx, 'course', existing.id, existing, deps);
  if (!snapshot.ok) return snapshot;

  const updated: Course = {
    ...existing,
    name: parsed.data.name ?? existing.name,
    description: parsed.data.description ?? existing.description,
    imageUrl: parsed.data.imageUrl === undefined ? existing.imageUrl : parsed.data.imageUrl,
    moduleOrder,
  };
  const saved = await deps.courses.update(tenant.value, updated, snapshot.value);
  return saved ? ok(saved) : err(notFound(`No course "${parsed.data.id}" in this tenant`));
};

export const createModule = async (
  ctx: Ctx,
  input: unknown,
  deps: CourseManagementDeps,
): Promise<Result<CourseModule, AppError>> => {
  const tenant = requireStaffTenant(ctx, 'course:write');
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
  const tenant = requireStaffTenant(ctx, 'course:write');
  if (!tenant.ok) return tenant;
  const parsed = updateCourseModuleInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid module update', parsed.error.flatten()));

  const existing = await deps.modules.findById(tenant.value, parsed.data.id);
  if (!existing) return err(notFound(`No module "${parsed.data.id}" in this tenant`));

  if (parsed.data.chapters) {
    const lessonCheck = await validateChapterLessons(tenant.value, parsed.data.chapters, deps);
    if (!lessonCheck.ok) return lessonCheck;
  }

  const snapshot = snapshotOf(ctx, 'course_module', existing.id, existing, deps);
  if (!snapshot.ok) return snapshot;

  const title = parsed.data.title ?? existing.title;
  const prefix = parsed.data.prefix === undefined ? existing.prefix : parsed.data.prefix;
  const updated: CourseModule = {
    ...existing,
    title,
    prefix,
    name: computeCourseModuleName(prefix, title),
    chapters: parsed.data.chapters ?? existing.chapters,
  };
  const saved = await deps.modules.update(tenant.value, updated, snapshot.value);
  return saved ? ok(saved) : err(notFound(`No module "${parsed.data.id}" in this tenant`));
};

export const createLesson = async (
  ctx: Ctx,
  input: unknown,
  deps: CourseManagementDeps,
): Promise<Result<CourseLesson, AppError>> => {
  const tenant = requireStaffTenant(ctx, 'course:write');
  if (!tenant.ok) return tenant;
  const parsed = newCourseLessonSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid lesson', parsed.error.flatten()));

  const lesson: CourseLesson = {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    name: parsed.data.name,
    contents: parsed.data.contents,
    ...(parsed.data.durationMinutes === undefined
      ? {}
      : { durationMinutes: parsed.data.durationMinutes }),
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
  const tenant = requireStaffTenant(ctx, 'course:write');
  if (!tenant.ok) return tenant;
  const parsed = updateCourseLessonInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid lesson update', parsed.error.flatten()));

  const existing = await deps.lessons.findById(tenant.value, parsed.data.id);
  if (!existing) return err(notFound(`No lesson "${parsed.data.id}" in this tenant`));

  const snapshot = snapshotOf(ctx, 'course_lesson', existing.id, existing, deps);
  if (!snapshot.ok) return snapshot;

  const { durationMinutes: existingDuration, ...base } = existing;
  const nextDuration =
    parsed.data.durationMinutes === undefined
      ? existingDuration
      : parsed.data.durationMinutes ?? undefined;
  const updated: CourseLesson = {
    ...base,
    name: parsed.data.name ?? existing.name,
    contents: parsed.data.contents ?? existing.contents,
    ...(nextDuration === undefined ? {} : { durationMinutes: nextDuration }),
  };
  const saved = await deps.lessons.update(tenant.value, updated, snapshot.value);
  return saved ? ok(saved) : err(notFound(`No lesson "${parsed.data.id}" in this tenant`));
};

export const attachModuleToCourse = async (
  ctx: Ctx,
  input: unknown,
  deps: CourseManagementDeps,
): Promise<Result<CourseModule, AppError>> => {
  const tenant = requireStaffTenant(ctx, 'course:write');
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
  if (!saved) return err(notFound(`No module "${parsed.data.moduleId}" in this tenant`));

  if (!course.moduleOrder.includes(module.id)) {
    const snapshot = snapshotOf(ctx, 'course', course.id, course, deps);
    if (!snapshot.ok) return snapshot;
    await deps.courses.update(
      tenant.value,
      { ...course, moduleOrder: [...course.moduleOrder, module.id] },
      snapshot.value,
    );
  }
  return ok(saved);
}

export const detachModuleFromCourse = async (
  ctx: Ctx,
  input: unknown,
  deps: CourseManagementDeps,
): Promise<Result<CourseModule, AppError>> => {
  const tenant = requireStaffTenant(ctx, 'course:write');
  if (!tenant.ok) return tenant;
  const parsed = detachModuleFromCourseInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid module detachment', parsed.error.flatten()));

  const course = await deps.courses.findById(tenant.value, parsed.data.courseId);
  if (!course) return err(notFound(`No course "${parsed.data.courseId}" in this tenant`));
  const module = await deps.modules.findById(tenant.value, parsed.data.moduleId);
  if (!module) return err(notFound(`No module "${parsed.data.moduleId}" in this tenant`));
  if (!module.courseIds.includes(course.id)) return ok(module);

  const updated: CourseModule = {
    ...module,
    courseIds: module.courseIds.filter((courseId) => courseId !== course.id),
  };
  const saved = await deps.modules.update(tenant.value, updated);
  if (!saved) return err(notFound(`No module "${parsed.data.moduleId}" in this tenant`));

  if (course.moduleOrder.includes(module.id)) {
    const snapshot = snapshotOf(ctx, 'course', course.id, course, deps);
    if (!snapshot.ok) return snapshot;
    await deps.courses.update(
      tenant.value,
      { ...course, moduleOrder: course.moduleOrder.filter((moduleId) => moduleId !== module.id) },
      snapshot.value,
    );
  }
  return ok(saved);
}

const collectLessonReferences = async (
  tenantId: string,
  lesson: CourseLesson,
  deps: Pick<CourseManagementDeps, 'modules' | 'products' | 'progress'>,
): Promise<LessonReferences> => {
  const [modules, products, progressCount] = await Promise.all([
    deps.modules.list(tenantId),
    deps.products.listByTenant(tenantId),
    deps.progress.countReferencingLesson(tenantId, lesson.id),
  ]);

  const chapters: LessonReferenceChapter[] = [];
  for (const module of modules) {
    for (const chapter of module.chapters) {
      for (const content of chapter.contents) {
        if (content.lessonId !== lesson.id) continue;
        chapters.push({
          moduleId: module.id,
          moduleName: module.name,
          chapterId: chapter.id,
          chapterName: chapter.name,
          contentId: content.id,
          contentName: content.name,
        });
      }
    }
  }

  const referencesLesson = (item: AccessItem): boolean =>
    item.level === 'lessons' && item.lessonIds.includes(lesson.id);
  const productRefs: LessonReferenceProduct[] = products
    .filter((product) => product.accessItems.some(referencesLesson))
    .map((product) => ({ productId: product.id, productTitle: product.title }));

  return { lessonId: lesson.id, lessonName: lesson.name, chapters, products: productRefs, progressCount };
};

export const listLessonReferences = async (
  ctx: Ctx,
  input: unknown,
  deps: CourseManagementDeps,
): Promise<Result<LessonReferences, AppError>> => {
  const tenant = requireStaffTenant(ctx, 'course:read');
  if (!tenant.ok) return tenant;
  const parsed = deleteCourseLessonInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid lesson reference query', parsed.error.flatten()));

  const lesson = await deps.lessons.findById(tenant.value, parsed.data.id);
  if (!lesson) return err(notFound(`No lesson "${parsed.data.id}" in this tenant`));

  return ok(await collectLessonReferences(tenant.value, lesson, deps));
};

const withoutLesson = (item: AccessItem, lessonId: string): AccessItem | null => {
  if (item.level !== 'lessons') return item;
  const lessonIds = item.lessonIds.filter((id) => id !== lessonId);
  if (lessonIds.length === 0) return null;
  return { ...item, lessonIds };
};

export const deleteLesson = async (
  ctx: Ctx,
  input: unknown,
  deps: CourseManagementDeps,
): Promise<Result<LessonReferences, AppError>> => {
  const tenant = requireStaffTenant(ctx, 'course:write');
  if (!tenant.ok) return tenant;
  const parsed = deleteCourseLessonInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid lesson deletion', parsed.error.flatten()));

  const lesson = await deps.lessons.findById(tenant.value, parsed.data.id);
  if (!lesson) return err(notFound(`No lesson "${parsed.data.id}" in this tenant`));

  const references = await collectLessonReferences(tenant.value, lesson, deps);

  await deleteLessonAttachmentObjects(ctx, lesson.id, deps);

  const deleted = await deps.lessons.delete(tenant.value, lesson.id);
  if (!deleted) return err(notFound(`No lesson "${parsed.data.id}" in this tenant`));

  const modules = await deps.modules.list(tenant.value);
  for (const module of modules) {
    const referencesLesson = module.chapters.some((chapter) =>
      chapter.contents.some((content) => content.lessonId === lesson.id),
    );
    if (!referencesLesson) continue;
    const chapters: Chapter[] = module.chapters.map((chapter) => ({
      ...chapter,
      contents: chapter.contents.filter((content) => content.lessonId !== lesson.id),
    }));
    const snapshot = snapshotOf(ctx, 'course_module', module.id, module, deps);
    if (!snapshot.ok) return snapshot;
    await deps.modules.update(tenant.value, { ...module, chapters }, snapshot.value);
  }

  const products = await deps.products.listByTenant(tenant.value);
  for (const product of products) {
    const referencesLesson = product.accessItems.some(
      (item) => item.level === 'lessons' && item.lessonIds.includes(lesson.id),
    );
    if (!referencesLesson) continue;
    const accessItems = product.accessItems
      .map((item) => withoutLesson(item, lesson.id))
      .filter((item): item is AccessItem => item !== null);
    const snapshot = snapshotOf(ctx, 'product', product.id, product, deps);
    if (!snapshot.ok) return snapshot;
    await deps.products.updateAccessItems(tenant.value, product.id, accessItems, snapshot.value);
  }

  return ok(references);
};

export const updateProductAccessItems = async (
  ctx: Ctx,
  input: UpdateProductAccessItemsInput,
  deps: CourseManagementDeps,
): Promise<Result<Product, AppError>> => {
  const tenant = requireStaffTenant(ctx, 'product:access:write');
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
    if (item.level === 'modules') {
      const moduleIds = unique(item.moduleIds);
      const modules = await deps.modules.findByIds(tenant.value, moduleIds);
      if (modules.length !== moduleIds.length) {
        return err(validation('Product access items may only reference existing modules'));
      }
      if (modules.some((module) => !module.courseIds.includes(item.courseId))) {
        return err(validation('Product access moduleIds must belong to the item courseId'));
      }
    } else if (item.level === 'lessons') {
      const lessonIds = unique(item.lessonIds);
      const lessons = await deps.lessons.findByIds(tenant.value, lessonIds);
      if (lessons.length !== lessonIds.length) {
        return err(validation('Product access items may only reference existing lessons'));
      }
    } else {
      const excludedModuleIds = unique(item.excludedModuleIds ?? []);
      if (excludedModuleIds.length > 0) {
        const modules = await deps.modules.findByIds(tenant.value, excludedModuleIds);
        if (modules.length !== excludedModuleIds.length) {
          return err(validation('Product access items may only reference existing modules'));
        }
        if (modules.some((module) => !module.courseIds.includes(item.courseId))) {
          return err(validation('Product access excludedModuleIds must belong to the item courseId'));
        }
      }
    }
  }

  const snapshot = snapshotOf(ctx, 'product', product.id, product, deps);
  if (!snapshot.ok) return snapshot;

  const updated = await deps.products.updateAccessItems(
    tenant.value,
    product.id,
    parsed.data.accessItems,
    snapshot.value,
    parsed.data.checkoutConsentDefinitionIds,
  );
  if (updated && parsed.data.checkoutConsentDefinitionIds !== undefined) {
    await deps.products.bumpContentVersion(tenant.value);
  }
  return updated ? ok(updated) : err(notFound(`No product "${parsed.data.id}" in this tenant`));
};
