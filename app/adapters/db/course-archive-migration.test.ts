import pg from 'pg';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildSnapshot, type Product } from '#core/domain/index.js';
import type { EntityVersionRecord } from '#core/server/index.js';

import { createCourseRepository, createProductRepository } from './repositories.js';
import { courses, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
let database: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  database = await createTestDatabase('together_course_archive', baseDatabaseUrl);
  await database.db.insert(tenants).values({
    id: 'archive-tenant', slug: 'acme', name: 'Acme', createdAt: '2026-10-11T00:00:00.000Z',
  });
});
afterAll(async () => { await database?.close(); });

describe('course archive migration', () => {
  it('adds a nullable timestamp and preserves archived courses for access evaluation', async () => {
    const { db } = database;
    const now = '2026-10-11T00:00:00.000Z';
    await db.insert(courses).values({ id: 'course', tenantId: 'archive-tenant', name: 'Course', description: '', createdAt: now });
    const columns = await db.execute(sql`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'courses' AND column_name = 'archived_at'`);
    expect(columns).toMatchObject({ rows: [{ data_type: 'timestamp with time zone', is_nullable: 'YES' }] });
    const repository = createCourseRepository(db);
    const existing = await repository.findById('archive-tenant', 'course');
    expect(existing?.archivedAt).toBeNull();
    if (existing === null) throw new Error('Expected migrated course');
    const snapshot = buildSnapshot('course', existing);
    if (!snapshot.ok) throw new Error('Expected course snapshot');
    const version = { id: 'archive-version', entityKind: 'course' as const, entityId: existing.id, schemaVersion: snapshot.value.schemaVersion, payload: snapshot.value.payload, createdAt: now, createdBy: null };
    expect(await repository.setArchived('archive-tenant', existing.id, now, version)).toMatchObject({ kind: 'saved', course: { archivedAt: now } });
    expect(await repository.update('archive-tenant', { ...existing, name: 'Updated course' })).toMatchObject({ archivedAt: now });
    expect(await repository.list('archive-tenant')).toMatchObject([{ id: 'course', archivedAt: now }]);
    expect(await repository.findByIds('archive-tenant', ['course'])).toHaveLength(1);
    expect(await repository.list('another-tenant')).toEqual([]);
    expect(await repository.setArchived('archive-tenant', existing.id, null, { ...version, id: 'restore-version' })).toMatchObject({ kind: 'saved', course: { archivedAt: null } });
  });
});

const now = '2026-10-11T00:00:00.000Z';
const tenantId = 'archive-tenant';
const makeProduct = (id: string, courseId?: string): Product => ({
  id, tenantId, type: 'course', slug: id, title: `Product ${id}`, description: '', coverUrl: null,
  priceCents: 100, currency: 'PLN', visibility: 'listed', published: false,
  accessItems: courseId === undefined ? [] : [{ level: 'course', courseId }], legacyId: null, createdAt: now,
});
const prepareCourse = async (id: string): Promise<EntityVersionRecord> => {
  const repository = createCourseRepository(database.db);
  await repository.create(tenantId, {
    id, tenantId, name: 'Course', description: '', imageUrl: null, moduleOrder: [],
    publiclyVisible: false, legacyId: null, createdAt: now,
  });
  const course = await repository.findById(tenantId, id);
  const snapshot = buildSnapshot('course', course);
  if (!snapshot.ok) throw new Error('Expected course snapshot');
  return { id: `version-${id}`, entityKind: 'course', entityId: id, schemaVersion: snapshot.value.schemaVersion, payload: snapshot.value.payload, createdAt: now, createdBy: null };
};
const waitForCourseLock = async (client: pg.Client): Promise<void> => {
  await expect.poll(async () => {
    const result = await client.query<{ waiting: unknown }>("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()) AS waiting");
    return result.rows[0]?.waiting === true;
  }, { timeout: 5000, interval: 10 }).toBe(true);
};

describe('course archive serialization', () => {
  it.each(['create', 'update'] as const)('refuses archive when a concurrent product %s commits its reference first', async (operation) => {
    const courseId = `writer-first-${operation}`;
    const version = await prepareCourse(courseId);
    const product = makeProduct(courseId);
    const repository = createProductRepository(database.db);
    if (operation === 'update') expect(await repository.create(tenantId, product)).toBe('created');
    const writer = new pg.Client({ connectionString: database.url });
    await writer.connect();
    try {
      await writer.query('BEGIN');
      await writer.query('SELECT id FROM courses WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, courseId]);
      if (operation === 'create') {
        await writer.query('INSERT INTO products (id, tenant_id, slug, title, description, price_cents, currency, published, access_items, created_at) VALUES ($1, $2, $1, $1, $3, 100, $4, false, $5::jsonb, $6)', [product.id, tenantId, '', 'PLN', JSON.stringify([{ level: 'course', courseId }]), now]);
      } else {
        await writer.query('UPDATE products SET access_items = $1::jsonb WHERE tenant_id = $2 AND id = $3', [JSON.stringify([{ level: 'course', courseId }]), tenantId, product.id]);
      }
      const archive = createCourseRepository(database.db).setArchived(tenantId, courseId, now, version);
      try {
        await waitForCourseLock(writer);
      } finally {
        await writer.query('COMMIT');
      }
      expect(await archive).toMatchObject({ kind: 'referenced', productTitles: [operation === 'create' ? product.id : product.title] });
      expect(await createCourseRepository(database.db).findById(tenantId, courseId)).toMatchObject({ archivedAt: null });
    } finally {
      await writer.end();
    }
  });

  it.each(['create', 'update'] as const)('refuses product %s when a concurrent archive commits first', async (operation) => {
    const courseId = `archive-first-${operation}`;
    await prepareCourse(courseId);
    const repository = createProductRepository(database.db);
    const product = makeProduct(courseId, courseId);
    if (operation === 'update') expect(await repository.create(tenantId, { ...product, accessItems: [] })).toBe('created');
    const archiver = new pg.Client({ connectionString: database.url });
    await archiver.connect();
    try {
      await archiver.query('BEGIN');
      await archiver.query('UPDATE courses SET archived_at = $1 WHERE tenant_id = $2 AND id = $3', [now, tenantId, courseId]);
      const write = operation === 'create'
        ? repository.create(tenantId, product)
        : repository.updateAccessItems(tenantId, product.id, product.accessItems);
      try {
        await waitForCourseLock(archiver);
      } finally {
        await archiver.query('COMMIT');
      }
      expect(await write).toBe('course_unavailable');
      expect(await repository.findById(tenantId, product.id)).toEqual(operation === 'create' ? null : expect.objectContaining({ accessItems: [] }));
    } finally {
      await archiver.end();
    }
  });

  it('rejects already archived references and allows them after restoring the course', async () => {
    const courseId = 'restore-reference';
    const version = await prepareCourse(courseId);
    const courses = createCourseRepository(database.db);
    const products = createProductRepository(database.db);
    expect(await courses.setArchived(tenantId, courseId, now, version)).toMatchObject({ kind: 'saved' });
    expect(await products.create(tenantId, makeProduct(courseId, courseId))).toBe('course_unavailable');
    expect(await courses.setArchived(tenantId, courseId, null, { ...version, id: 'restored-reference' })).toMatchObject({ kind: 'saved' });
    expect(await products.create(tenantId, makeProduct(courseId, courseId))).toBe('created');
    expect(await courses.setArchived(tenantId, courseId, now, { ...version, id: 'refused-archive' })).toMatchObject({ kind: 'referenced', productTitles: [`Product ${courseId}`] });
  });
});
