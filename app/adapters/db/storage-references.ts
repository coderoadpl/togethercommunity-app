import { eq, sql } from 'drizzle-orm';

import { storageReferenceInventorySchema } from '#core/domain/index.js';
import type { StorageReferenceRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import {
  campaigns,
  emailLayouts,
  courseLessons,
  courseModules,
  courses,
  dmMessages,
  entityVersions,
  lessonAttachments,
  members,
  posts,
  productDownloadAssets,
  products,
  spaceEvents,
  spaces,
  tenantDocumentVersions,
  tenants,
} from './schema.js';

export const createStorageReferenceRepository = (db: Db): StorageReferenceRepository => ({
  readInventory: async (tenantId) => db.transaction(async (tx) => {
    await tx.execute(sql`set transaction isolation level repeatable read, read only`);
    const lessonRows = await tx.select({ id: courseLessons.id, contents: courseLessons.contents })
      .from(courseLessons).where(eq(courseLessons.tenantId, tenantId));
    const productRows = await tx.select({ id: products.id, coverUrl: products.coverUrl, description: products.description })
      .from(products).where(eq(products.tenantId, tenantId));
    const courseRows = await tx.select({ imageUrl: courses.imageUrl, description: courses.description })
      .from(courses).where(eq(courses.tenantId, tenantId));
    const moduleRows = await tx.select({ chapters: courseModules.chapters })
      .from(courseModules).where(eq(courseModules.tenantId, tenantId));
    const branding = await tx.select({
      logoUrl: tenants.logoUrl,
      logoDarkUrl: tenants.logoDarkUrl,
      faviconUrl: tenants.faviconUrl,
      ogImageUrl: tenants.ogImageUrl,
    }).from(tenants).where(eq(tenants.id, tenantId));
    const avatars = await tx.select({ avatarUrl: members.avatarUrl })
      .from(members).where(eq(members.tenantId, tenantId));
    const attachments = await tx.select({ storageKey: lessonAttachments.storageKey, status: lessonAttachments.status })
      .from(lessonAttachments).where(eq(lessonAttachments.tenantId, tenantId));
    const downloads = await tx.select({
      storageKey: productDownloadAssets.storageKey,
      status: productDownloadAssets.status,
      supersededAt: productDownloadAssets.supersededAt,
    }).from(productDownloadAssets).where(eq(productDownloadAssets.tenantId, tenantId));
    const versions = await tx.select({ entityKind: entityVersions.entityKind, entityId: entityVersions.entityId, payload: entityVersions.payload })
      .from(entityVersions).where(eq(entityVersions.tenantId, tenantId));
    const postRows = await tx.select({ body: posts.body }).from(posts).where(eq(posts.tenantId, tenantId));
    const messages = await tx.select({ body: dmMessages.body }).from(dmMessages).where(eq(dmMessages.tenantId, tenantId));
    const spaceRows = await tx.select({ description: spaces.description }).from(spaces).where(eq(spaces.tenantId, tenantId));
    const events = await tx.select({ description: spaceEvents.description }).from(spaceEvents).where(eq(spaceEvents.tenantId, tenantId));
    const documents = await tx.select({ content: tenantDocumentVersions.content })
      .from(tenantDocumentVersions).where(eq(tenantDocumentVersions.tenantId, tenantId));
    const layouts = await tx.select({ bodyHtml: emailLayouts.bodyHtml }).from(emailLayouts).where(eq(emailLayouts.tenantId, tenantId));
    const campaignRows = await tx.select({ bodyHtml: campaigns.bodyHtml, bodySource: campaigns.bodySource })
      .from(campaigns).where(eq(campaigns.tenantId, tenantId));
    return storageReferenceInventorySchema.parse({
      lessonIds: [...new Set([
        ...lessonRows.map((row) => row.id),
        ...versions.filter((row) => row.entityKind === 'course_lesson').map((row) => row.entityId),
      ])],
      productIds: [...new Set([
        ...productRows.map((row) => row.id),
        ...versions.filter((row) => row.entityKind === 'product').map((row) => row.entityId),
      ])],
      attachments,
      downloads,
      currentDocuments: [...lessonRows, ...productRows, ...courseRows, ...moduleRows, ...branding, ...avatars,
        ...postRows, ...messages, ...spaceRows, ...events, ...layouts, ...campaignRows],
      historyDocuments: [...versions.map((row) => row.payload), ...documents],
    });
  }),
});
