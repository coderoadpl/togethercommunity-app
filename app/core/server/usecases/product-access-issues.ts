import {
  err,
  forbidden,
  ok,
  tenantNotFound,
  type AppError,
  type ProductAccessIssues,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  ProductRepository,
} from '../ports.js';

export interface ProductAccessIssuesDeps {
  products: ProductRepository;
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: CourseLessonRepository;
}

const requireStaffTenant = (ctx: Ctx): Result<string, AppError> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to inspect products'));
  if (!ctx.identity.staffRole) return err(forbidden('Only tenant staff can inspect products'));
  return ok(ctx.identity.tenantId);
};

export const listProductAccessIssues = async (
  ctx: Ctx,
  deps: ProductAccessIssuesDeps,
): Promise<Result<ProductAccessIssues[], AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;

  const [products, courses, modules, lessons] = await Promise.all([
    deps.products.listByTenant(tenant.value),
    deps.courses.list(tenant.value),
    deps.modules.list(tenant.value),
    deps.lessons.list(tenant.value),
  ]);

  const courseIds = new Set(courses.map((course) => course.id));
  const moduleIds = new Set(modules.map((module) => module.id));
  const lessonIds = new Set(lessons.map((lesson) => lesson.id));

  const reachableModulesByCourse = new Map<string, Set<string>>();
  const reachableLessonsByCourse = new Map<string, Set<string>>();
  for (const courseId of courseIds) {
    reachableModulesByCourse.set(courseId, new Set());
    reachableLessonsByCourse.set(courseId, new Set());
  }
  for (const module of modules) {
    for (const courseId of module.courseIds) {
      reachableModulesByCourse.get(courseId)?.add(module.id);
      const reachableLessons = reachableLessonsByCourse.get(courseId);
      if (!reachableLessons) continue;
      for (const chapter of module.chapters) {
        for (const chapterContent of chapter.contents) reachableLessons.add(chapterContent.lessonId);
      }
    }
  }

  const issues: ProductAccessIssues[] = [];
  for (const product of products) {
    const missingCourseIds = new Set<string>();
    const missingModuleIds = new Set<string>();
    const missingLessonIds = new Set<string>();
    const unreachableModuleIds = new Set<string>();
    const unreachableLessonIds = new Set<string>();

    for (const item of product.accessItems) {
      const courseExists = courseIds.has(item.courseId);
      if (!courseExists) missingCourseIds.add(item.courseId);
      const reachableModules = reachableModulesByCourse.get(item.courseId);
      const reachableLessons = reachableLessonsByCourse.get(item.courseId);
      if (item.level === 'modules') {
        for (const id of item.moduleIds) {
          if (!moduleIds.has(id)) missingModuleIds.add(id);
          else if (courseExists && !reachableModules?.has(id)) unreachableModuleIds.add(id);
        }
      } else if (item.level === 'lessons') {
        for (const id of item.lessonIds) {
          if (!lessonIds.has(id)) missingLessonIds.add(id);
          else if (courseExists && !reachableLessons?.has(id)) unreachableLessonIds.add(id);
        }
      } else {
        for (const id of item.excludedModuleIds ?? []) if (!moduleIds.has(id)) missingModuleIds.add(id);
      }
    }

    if (
      missingCourseIds.size > 0 ||
      missingModuleIds.size > 0 ||
      missingLessonIds.size > 0 ||
      unreachableModuleIds.size > 0 ||
      unreachableLessonIds.size > 0
    ) {
      issues.push({
        productId: product.id,
        productTitle: product.title,
        missingCourseIds: [...missingCourseIds],
        missingModuleIds: [...missingModuleIds],
        missingLessonIds: [...missingLessonIds],
        unreachableModuleIds: [...unreachableModuleIds],
        unreachableLessonIds: [...unreachableLessonIds],
      });
    }
  }

  return ok(issues);
};
