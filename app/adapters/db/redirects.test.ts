import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ImportRedirectMutation } from '#core/server/index.js';

import type { Db } from './client.js';
import { createTenantRedirectRepository } from './redirects.js';
import { createTestDatabase } from './test-database-name.js';
import { tenantApiKeys, tenants } from './schema.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const NOW = '1998-08-14T10:00:00.000Z';
const TENANT_ID = 'tenant-redirects';
const OTHER_TENANT_ID = 'tenant-redirects-other';

let db: Db;
let closeTestDatabase: () => Promise<void>;

beforeAll(async () => {
  const testDatabase = await createTestDatabase('together_redirects_test', baseDatabaseUrl);
  db = testDatabase.db;
  closeTestDatabase = testDatabase.close;
  const workspaces = [
    { id: TENANT_ID, slug: 'redirects' },
    { id: OTHER_TENANT_ID, slug: 'redirects-other' },
  ];
  for (const workspace of workspaces) {
    await db.insert(tenants).values({
      id: workspace.id,
      slug: workspace.slug,
      name: 'Redirects',
      createdAt: NOW,
    });
    await db.insert(tenantApiKeys).values({
      id: `import-key-${workspace.slug}`,
      tenantId: workspace.id,
      name: 'Import',
      keyHash: `redirects-key-hash-${workspace.slug}`,
      scopes: ['import:content'],
      createdAt: NOW,
      expiresAt: '1998-08-20T10:00:00.000Z',
    });
  }
}, 60_000);

afterAll(async () => {
  await closeTestDatabase();
});

const mutation = (
  overrides: Partial<ImportRedirectMutation['resource']> = {},
  action: ImportRedirectMutation['action'] = 'created',
  tenantId = TENANT_ID,
): ImportRedirectMutation => ({
  action,
  resource: {
    id: 'redirect-course',
    tenantId,
    fromPath: '/course/javascript',
    targetKind: 'course',
    targetId: 'course-js',
    targetPath: '/my/courses/course-js',
    permanent: true,
    origin: 'import',
    createdBy: null,
    createdAt: NOW,
    ...overrides,
  },
  event: {
    id: `audit-${overrides.id ?? 'redirect-course'}-${action}-${tenantId}`,
    tenantId,
    apiKeyId: tenantId === TENANT_ID ? 'import-key-redirects' : 'import-key-redirects-other',
    kind: 'redirect',
    importKey: overrides.id ?? 'redirect-course',
    resourceId: overrides.id ?? 'redirect-course',
    action,
    payloadHash: 'a'.repeat(64),
    at: NOW,
  },
});

describe('tenant redirect repository', () => {
  it('commits a redirect, reads it back by path, and updates it in place', async () => {
    const repository = createTenantRedirectRepository(db);

    expect(await repository.commit(TENANT_ID, mutation())).toBe('saved');
    expect(await repository.findByFromPath(TENANT_ID, '/course/javascript')).toMatchObject({
      id: 'redirect-course',
      targetPath: '/my/courses/course-js',
      permanent: true,
    });
    expect(await repository.commit(TENANT_ID, mutation({ permanent: false }, 'updated'))).toBe('saved');
    expect(await repository.findById(TENANT_ID, 'redirect-course')).toMatchObject({ permanent: false });
  });

  it('refuses a second redirect for the same path but allows it for another tenant', async () => {
    const repository = createTenantRedirectRepository(db);

    expect(await repository.commit(TENANT_ID, mutation({ id: 'redirect-duplicate' }))).toBe('path_taken');
    expect(await repository.commit(
      OTHER_TENANT_ID,
      mutation({ id: 'redirect-other-tenant' }, 'created', OTHER_TENANT_ID),
    )).toBe('saved');
    expect(await repository.findById(TENANT_ID, 'redirect-other-tenant')).toBeNull();
    expect(await repository.listPage(TENANT_ID, { limit: 50, offset: 0 })).toMatchObject({ total: 1 });
  });

  it('creates a manual redirect, refuses a taken path, and deletes it', async () => {
    const repository = createTenantRedirectRepository(db);
    const manual = {
      ...mutation({ id: 'redirect-manual', fromPath: '/offer' }).resource,
      origin: 'manual' as const,
      createdBy: 'user-owner',
    };

    expect(await repository.create(TENANT_ID, manual)).toBe('saved');
    expect(await repository.create(TENANT_ID, { ...manual, id: 'redirect-manual-twin' }))
      .toBe('path_taken');
    expect(await repository.findById(TENANT_ID, 'redirect-manual'))
      .toMatchObject({ origin: 'manual', createdBy: 'user-owner' });
    expect(await repository.deleteById(OTHER_TENANT_ID, 'redirect-manual')).toBe(false);
    expect(await repository.deleteById(TENANT_ID, 'redirect-manual')).toBe(true);
    expect(await repository.findById(TENANT_ID, 'redirect-manual')).toBeNull();
  });

  it('pages and searches over both paths, ordered by source path', async () => {
    const repository = createTenantRedirectRepository(db);
    for (const [index, fromPath] of ['/a-one', '/a-two', '/b-three'].entries()) {
      expect(await repository.create(TENANT_ID, {
        ...mutation({ id: `redirect-page-${String(index)}`, fromPath }).resource,
        targetPath: index === 2 ? '/my/needle' : '/my',
      })).toBe('saved');
    }

    const firstPage = await repository.listPage(TENANT_ID, { limit: 2, offset: 0 });
    expect(firstPage.redirects.map((entry) => entry.fromPath)).toEqual(['/a-one', '/a-two']);
    expect(firstPage.total).toBe(4);

    const secondPage = await repository.listPage(TENANT_ID, { limit: 2, offset: 2 });
    expect(secondPage.redirects.map((entry) => entry.fromPath)).toEqual(['/b-three', '/course/javascript']);

    expect(await repository.listPage(TENANT_ID, { limit: 50, offset: 0, search: 'needle' }))
      .toMatchObject({ total: 1, redirects: [{ fromPath: '/b-three' }] });
    expect(await repository.listPage(TENANT_ID, { limit: 50, offset: 0, search: 'a-t' }))
      .toMatchObject({ total: 1, redirects: [{ fromPath: '/a-two' }] });
    expect(await repository.listPage(TENANT_ID, { limit: 50, offset: 0, search: '%' }))
      .toMatchObject({ total: 0 });
    expect(await repository.listPage(TENANT_ID, { limit: 0, offset: 0 }))
      .toEqual({ total: 4, redirects: [] });
  });

  it('refuses to let an import update a manual row', async () => {
    const repository = createTenantRedirectRepository(db);
    const manual = {
      ...mutation({ id: 'redirect-owned', fromPath: '/promocja' }).resource,
      origin: 'manual' as const,
      createdBy: 'user-owner',
    };

    expect(await repository.create(TENANT_ID, manual)).toBe('saved');
    expect(await repository.commit(
      TENANT_ID,
      mutation({ id: 'redirect-owned', fromPath: '/promocja', targetPath: '/my/needle' }, 'updated'),
    )).toBe('conflict');
    expect(await repository.findById(TENANT_ID, 'redirect-owned'))
      .toMatchObject({ origin: 'manual', targetPath: '/my/courses/course-js', createdBy: 'user-owner' });
  });
});
