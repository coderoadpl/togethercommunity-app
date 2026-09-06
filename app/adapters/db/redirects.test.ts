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
    fromPath: '/kurs/javascript',
    targetKind: 'course',
    targetId: 'course-js',
    targetPath: '/my/courses/course-js',
    permanent: true,
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
    expect(await repository.findByFromPath(TENANT_ID, '/kurs/javascript')).toMatchObject({
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
    expect(await repository.listByTenant(TENANT_ID)).toHaveLength(1);
  });
});
