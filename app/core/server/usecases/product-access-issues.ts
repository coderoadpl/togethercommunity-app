import {
  err,
  forbidden,
  ok,
  tenantNotFound,
  type AppError,
  type ProductAccessIssues,
  type Result,
} from '@core/domain/index.js';

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

  const issues: ProductAccessIssues[] = [];
  for (const product of products) {
    const missingCourseIds = new Set<string>();
    const missingModuleIds = new Set<string>();
    const missingLessonIds = new Set<string>();

    for (const item of product.accessItems) {
      if (!courseIds.has(item.courseId)) missingCourseIds.add(item.courseId);
      if (item.level === 'modules') {
        for (const id of item.moduleIds) if (!moduleIds.has(id)) missingModuleIds.add(id);
      } else if (item.level === 'lessons') {
        for (const id of item.lessonIds) if (!lessonIds.has(id)) missingLessonIds.add(id);
      } else {
        for (const id of item.excludedModuleIds ?? []) if (!moduleIds.has(id)) missingModuleIds.add(id);
      }
    }

    if (missingCourseIds.size > 0 || missingModuleIds.size > 0 || missingLessonIds.size > 0) {
      issues.push({
        productId: product.id,
        productTitle: product.title,
        missingCourseIds: [...missingCourseIds],
        missingModuleIds: [...missingModuleIds],
        missingLessonIds: [...missingLessonIds],
      });
    }
  }

  return ok(issues);
};
