import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { EntityVersionRecord } from '#core/server/index.js';

import type { Db } from './client.js';
import { createImportContentRepository } from './content-import.js';
import { insertEntityVersion } from './entity-versions.js';
import { createEntityVersionRepository } from './repositories.js';
import { tenantApiKeys, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

const TENANT = 'tenant-versions';

const snapshot = (id: string, createdAt: string, name: string): EntityVersionRecord => ({
  id,
  entityKind: 'course',
  entityId: 'course-1',
  schemaVersion: 4,
  payload: {
    id: 'course-1',
    tenantId: TENANT,
    name,
    description: '',
    imageUrl: null,
    moduleOrder: [],
    publiclyVisible: false,
    legacyId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  createdAt,
  createdBy: 'user-1',
});

describe('entity version repository', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase('together_entity_versions', baseDatabaseUrl));
    await db.insert(tenants).values({
      id: TENANT,
      slug: 'versions',
      name: 'Versions',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await insertEntityVersion(db, TENANT, snapshot('v1', '2026-01-01T00:00:00.000Z', 'First'));
    await insertEntityVersion(db, TENANT, snapshot('v2', '2026-01-02T00:00:00.000Z', 'Second'));
    await insertEntityVersion(db, TENANT, snapshot('v3', '2026-01-03T00:00:00.000Z', 'Third'));
  });

  afterAll(async () => {
    await close();
  });

  it('numbers versions oldest-first even when the page shows only the newest', async () => {
    const repository = createEntityVersionRepository(db);

    const page = await repository.list(TENANT, {
      entityKind: 'course',
      entityId: 'course-1',
      limit: 2,
    });

    expect(page.map((version) => [version.id, version.ordinal])).toEqual([
      ['v3', 3],
      ['v2', 2],
    ]);
  });

  it('carries the same ordinal on a single-version fetch', async () => {
    const repository = createEntityVersionRepository(db);

    expect(await repository.findById(TENANT, 'v1')).toMatchObject({ id: 'v1', ordinal: 1 });
    expect(await repository.findById(TENANT, 'v3')).toMatchObject({ id: 'v3', ordinal: 3 });
  });

  it('skips a snapshot identical to the latest stored one', async () => {
    await insertEntityVersion(db, TENANT, snapshot('v4', '2026-01-04T00:00:00.000Z', 'Third'));

    const repository = createEntityVersionRepository(db);
    const page = await repository.list(TENANT, {
      entityKind: 'course',
      entityId: 'course-1',
      limit: 10,
    });

    expect(page.map((version) => version.id)).toEqual(['v3', 'v2', 'v1']);
  });
});

describe('import content repository', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase('together_import_versions', baseDatabaseUrl));
    await db.insert(tenants).values({
      id: TENANT,
      slug: 'import-versions',
      name: 'Import versions',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await db.insert(tenantApiKeys).values({
      id: 'key-1',
      tenantId: TENANT,
      name: 'Migration',
      keyHash: 'hash-1',
      scopes: ['import:content'],
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: null,
      revokedAt: null,
    });
  });

  afterAll(async () => {
    await close();
  });

  it('stores the version it writes in the same transaction as the record', async () => {
    const repository = createImportContentRepository(db);
    const resource = {
      id: 'imported-course',
      tenantId: TENANT,
      name: 'Imported course',
      description: '',
      imageUrl: null,
      moduleOrder: [],
      publiclyVisible: false,
      legacyId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    const committed = await repository.commit(TENANT, {
      kind: 'course',
      action: 'created',
      resource,
      event: {
        id: 'audit-1',
        tenantId: TENANT,
        apiKeyId: 'key-1',
        kind: 'course',
        importKey: 'imported-course',
        resourceId: resource.id,
        action: 'created',
        payloadHash: 'a'.repeat(64),
        at: '2026-01-01T00:00:00.000Z',
      },
      version: {
        id: 'imported-version-1',
        entityKind: 'course',
        entityId: resource.id,
        schemaVersion: 4,
        payload: resource,
        createdAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'Migration',
      },
    });

    expect(committed).toBe('saved');
    expect(
      await createEntityVersionRepository(db).list(TENANT, {
        entityKind: 'course',
        entityId: resource.id,
        limit: 10,
      }),
    ).toMatchObject([{ id: 'imported-version-1', ordinal: 1, createdBy: 'Migration' }]);
  });
});
