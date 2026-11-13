import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Db } from './client.js';
import { courseLessons, courses, entityVersions, lessonAttachments, productDownloadAssets, products, tenants } from './schema.js';
import { createStorageReferenceRepository } from './storage-references.js';
import { createTestDatabase } from './test-database-name.js';

const NOW = '2026-11-08T12:00:00.000Z';
const databaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres';

describe('storage reference inventory', () => {
  let db: Db;
  let close: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase('together_storage_references', databaseUrl));
    for (const tenantId of ['tenant-a', 'tenant-b']) {
      await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: tenantId, createdAt: NOW, logoUrl: `${tenantId}-logo` });
      await db.insert(courseLessons).values({ id: 'same-lesson', tenantId, name: 'Lesson', contents: [], createdAt: NOW });
      await db.insert(courses).values({ id: 'same-course', tenantId, name: 'Course', description: '', imageUrl: `${tenantId}-cover`, createdAt: NOW });
      await db.insert(products).values({ id: 'same-product', tenantId, slug: 'product', title: 'Product', description: '', priceCents: 100, currency: 'USD', createdAt: NOW });
      await db.insert(lessonAttachments).values({
        id: `${tenantId}-attachment`, tenantId, lessonId: 'same-lesson', storageKey: `lesson-attachments/same-lesson/${tenantId}/file.pdf`,
        fileName: 'file.pdf', contentType: 'application/pdf', sizeBytes: 10, status: 'pending', createdAt: NOW,
      });
      await db.insert(productDownloadAssets).values({
        id: `${tenantId}-download`, tenantId, productId: 'same-product', lineageId: `${tenantId}-lineage`, versionNumber: 1,
        supersededAt: NOW, storageKey: `${tenantId}/product-downloads/same-product/old/file.pdf`,
        fileName: 'file.pdf', contentType: 'application/pdf', sizeBytes: 10, status: 'ready', createdAt: NOW,
      });
      await db.insert(entityVersions).values({
        id: `${tenantId}-snapshot`, tenantId, entityKind: 'course_lesson', entityId: 'deleted-lesson', schemaVersion: 1,
        payload: { imageUrl: `${tenantId}-historical-cover` }, createdAt: NOW,
      });
    }
  });

  afterAll(async () => { await close?.(); });

  it('reads only the selected tenant, including pending uploads, superseded versions and deleted resource history', async () => {
    const repository = createStorageReferenceRepository(db);
    const inventory = await repository.readInventory('tenant-a');
    expect(inventory.lessonIds).toEqual(['same-lesson', 'deleted-lesson']);
    expect(inventory.productIds).toEqual(['same-product']);
    expect(inventory.attachments).toEqual([{ storageKey: 'lesson-attachments/same-lesson/tenant-a/file.pdf', status: 'pending' }]);
    expect(inventory.downloads).toEqual([{
      storageKey: 'tenant-a/product-downloads/same-product/old/file.pdf', status: 'ready', supersededAt: NOW,
    }]);
    expect(inventory.historyDocuments).toEqual([{ imageUrl: 'tenant-a-historical-cover' }]);
    expect(JSON.stringify(inventory.currentDocuments)).toContain('tenant-a-logo');
    expect(JSON.stringify(inventory.currentDocuments)).toContain('tenant-a-cover');
    expect(JSON.stringify(inventory)).not.toContain('tenant-b');
    expect(await repository.readInventory('tenant-a')).toEqual(inventory);
    expect(await repository.readInventory('missing')).toEqual({
      lessonIds: [], productIds: [], attachments: [], downloads: [], currentDocuments: [], historyDocuments: [],
    });
  });
});
