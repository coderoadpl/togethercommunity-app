import { and, eq } from 'drizzle-orm';

import {
  courseLessonSchema,
  courseModuleSchema,
  courseSchema,
  importAuditEventSchema,
  productSchema,
} from '#core/domain/index.js';
import type { ImportContentMutation, ImportContentRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { uniqueViolation } from './pg-errors.js';
import {
  courseLessons,
  courseModules,
  courses,
  importAuditEvents,
  products,
  tenantApiKeys,
} from './schema.js';

const insertAuditEvent = async (
  executor: Db,
  tenantId: string,
  mutation: ImportContentMutation,
): Promise<void> => {
  const event = importAuditEventSchema.parse(mutation.event);
  const [owned] = await executor
    .select({ id: tenantApiKeys.id })
    .from(tenantApiKeys)
    .where(and(eq(tenantApiKeys.tenantId, tenantId), eq(tenantApiKeys.id, event.apiKeyId)))
    .limit(1);
  if (owned === undefined) throw new Error('Import audit API key does not belong to tenant');
  await executor.insert(importAuditEvents).values({
    id: event.id,
    tenantId,
    apiKeyId: event.apiKeyId,
    kind: event.kind,
    importKey: event.importKey,
    resourceId: event.resourceId,
    action: event.action,
    payloadHash: event.payloadHash,
    at: event.at,
  });
};

const createResource = async (
  executor: Db,
  tenantId: string,
  mutation: ImportContentMutation,
): Promise<void> => {
  if (mutation.kind === 'course') {
    const course = courseSchema.parse(mutation.resource);
    await executor.insert(courses).values({ ...course, tenantId });
    return;
  }
  if (mutation.kind === 'module') {
    const module = courseModuleSchema.parse(mutation.resource);
    await executor.insert(courseModules).values({
      id: module.id,
      tenantId,
      courseIds: module.courseIds,
      title: module.title,
      prefix: module.prefix,
      chapters: module.chapters,
      legacyId: module.legacyId,
      createdAt: module.createdAt,
    });
    return;
  }
  if (mutation.kind === 'lesson') {
    const lesson = courseLessonSchema.parse(mutation.resource);
    await executor.insert(courseLessons).values({ ...lesson, tenantId });
    return;
  }
  const product = productSchema.parse(mutation.resource);
  await executor.insert(products).values({
    ...product,
    tenantId,
    checkoutConsentDefinitionIds: product.checkoutConsentDefinitionIds ?? [],
  });
};

const updateResource = async (
  executor: Db,
  tenantId: string,
  mutation: ImportContentMutation,
): Promise<boolean> => {
  if (mutation.kind === 'course') {
    const course = courseSchema.parse(mutation.resource);
    const rows = await executor.update(courses).set({
      name: course.name,
      description: course.description,
      imageUrl: course.imageUrl,
      moduleOrder: course.moduleOrder,
      legacyId: course.legacyId,
      createdAt: course.createdAt,
    }).where(and(eq(courses.tenantId, tenantId), eq(courses.id, course.id))).returning({ id: courses.id });
    return rows.length === 1;
  }
  if (mutation.kind === 'module') {
    const module = courseModuleSchema.parse(mutation.resource);
    const rows = await executor.update(courseModules).set({
      courseIds: module.courseIds,
      title: module.title,
      prefix: module.prefix,
      chapters: module.chapters,
      legacyId: module.legacyId,
      createdAt: module.createdAt,
    }).where(and(eq(courseModules.tenantId, tenantId), eq(courseModules.id, module.id)))
      .returning({ id: courseModules.id });
    return rows.length === 1;
  }
  if (mutation.kind === 'lesson') {
    const lesson = courseLessonSchema.parse(mutation.resource);
    const rows = await executor.update(courseLessons).set({
      name: lesson.name,
      isPreview: lesson.isPreview,
      contents: lesson.contents,
      durationMinutes: lesson.durationMinutes ?? null,
      legacyId: lesson.legacyId,
      createdAt: lesson.createdAt,
    }).where(and(eq(courseLessons.tenantId, tenantId), eq(courseLessons.id, lesson.id)))
      .returning({ id: courseLessons.id });
    return rows.length === 1;
  }
  const product = productSchema.parse(mutation.resource);
  const rows = await executor.update(products).set({
    type: product.type,
    slug: product.slug,
    title: product.title,
    description: product.description,
    coverUrl: product.coverUrl,
    priceCents: product.priceCents,
    currency: product.currency,
    accessItems: product.accessItems,
    legacyId: product.legacyId,
    createdAt: product.createdAt,
  }).where(and(
    eq(products.tenantId, tenantId),
    eq(products.id, product.id),
    eq(products.published, false),
  )).returning({ id: products.id });
  return rows.length === 1;
};

export const createImportContentRepository = (db: Db): ImportContentRepository => ({
  commit: async (tenantId, mutation) => {
    try {
      return await db.transaction(async (tx) => {
        if (mutation.action === 'created') await createResource(tx, tenantId, mutation);
        if (mutation.action === 'updated' && !await updateResource(tx, tenantId, mutation)) return 'conflict';
        await insertAuditEvent(tx, tenantId, mutation);
        return 'saved';
      });
    } catch (cause) {
      if (mutation.kind === 'product' && uniqueViolation(cause, 'products_tenant_slug_uidx')) {
        return 'slug_taken';
      }
      if (uniqueViolation(cause)) return 'conflict';
      throw cause;
    }
  },
});
