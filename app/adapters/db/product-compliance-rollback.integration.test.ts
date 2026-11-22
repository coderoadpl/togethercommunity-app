import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { productSchema, type Product, type ProductCompliance } from '#core/domain/index.js';
import type { EntityVersionRecord } from '#core/server/index.js';

import type { Db } from './client.js';
import { createImportContentRepository } from './content-import.js';
import { createProductRepository } from './repositories.js';
import { products, tenantApiKeys, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

const TENANT = 'tenant-compliance-rollback';

const previousReleaseComplianceSchema = z.object({
  manufacturerName: z.string().trim().min(1, 'Manufacturer name must not be empty').max(200),
  manufacturerAddress: z.string().trim().min(1, 'Manufacturer address must not be empty').max(300),
  manufacturerEmail: z.string().trim().email('Manufacturer e-mail must be a valid address').max(254),
  modelIdentifier: z.string().trim().min(1, 'Model identifier must not be empty').max(100),
  batchIdentifier: z.string().trim().min(1).max(100).nullable().optional(),
  safetyWarnings: z.string().max(5000, 'Safety warnings are too long').default(''),
  instructionsUrl: z
    .string()
    .trim()
    .url('Instructions URL must be a valid URL')
    .regex(/^https:\/\//iu, 'Instructions URL must use HTTPS')
    .nullable()
    .optional(),
}).strict();

const manufacturerInEu = {
  manufacturerName: 'Example Workshop',
  manufacturerAddress: 'Example Street 1, 00-001 Warsaw',
  manufacturerEmail: 'safety@example.com',
  modelIdentifier: 'STAND-1',
  safetyWarnings: 'Keep dry.',
};

const manufacturerOutsideEu = {
  ...manufacturerInEu,
  manufacturerOutsideEu: true,
  responsiblePersonName: 'Example EU Representative',
  responsiblePersonAddress: 'Example Street 2, 00-001 Warsaw',
  responsiblePersonEmail: 'eu-rep@example.com',
};

const product = (id: string, compliance: unknown, title = 'Stand'): Product => productSchema.parse({
  id, tenantId: TENANT, type: 'physical', slug: id, title, description: '', coverUrl: null, priceCents: 4900,
  currency: 'PLN', published: false, deliveryMethod: 'pickup', accessItems: [], legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z', compliance,
});

const version = (resource: Product, id: string): EntityVersionRecord => ({
  id, entityKind: 'product', entityId: resource.id, schemaVersion: 11, payload: resource,
  createdAt: '2026-01-02T00:00:00.000Z', createdBy: 'user-1',
});

const importEvent = (resourceId: string, id: string, action: 'created' | 'updated') => ({
  id, tenantId: TENANT, apiKeyId: 'key-1', kind: 'product' as const, importKey: resourceId, resourceId, action,
  payloadHash: id.repeat(64).slice(0, 64), at: '2026-01-01T00:00:00.000Z',
});

describe('stored product safety information read by the previous release', () => {
  let db: Db;
  let close: () => Promise<void>;

  const storedCompliance = async (id: string): Promise<unknown> =>
    (await db.select({ compliance: products.compliance }).from(products).where(eq(products.id, id)))[0]?.compliance;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase('together_compliance_rollback', baseDatabaseUrl));
    await db.insert(tenants).values({ id: TENANT, slug: 'compliance-rollback', name: 'Compliance rollback', createdAt: '2026-01-01T00:00:00.000Z' });
    await db.insert(tenantApiKeys).values({
      id: 'key-1', tenantId: TENANT, name: 'Migration', keyHash: 'hash-compliance-rollback', scopes: ['import:content'],
      createdAt: '2026-01-01T00:00:00.000Z', expiresAt: null, revokedAt: null,
    });
  });

  afterAll(async () => {
    await close();
  });

  it('keeps a product saved with the manufacturer in the EU readable on create and on update', async () => {
    const repository = createProductRepository(db);
    const created = product('rollback-created', manufacturerInEu);
    expect(created.compliance?.manufacturerOutsideEu).toBe(false);

    expect(await repository.create(TENANT, created)).toBe('created');
    expect(previousReleaseComplianceSchema.safeParse(await storedCompliance(created.id)).success).toBe(true);

    const updated = product(created.id, { ...manufacturerInEu, manufacturerOutsideEu: false, safetyWarnings: 'Keep away from fire.' }, 'Stand, updated');
    expect(await repository.update(TENANT, updated, version(updated, 'rollback-version-1'))).toMatchObject({
      compliance: { manufacturerOutsideEu: false, safetyWarnings: 'Keep away from fire.' },
    });
    expect(previousReleaseComplianceSchema.parse(await storedCompliance(created.id))).toEqual({ ...manufacturerInEu, safetyWarnings: 'Keep away from fire.' });
    expect((await repository.findById(TENANT, created.id))?.compliance).toEqual<ProductCompliance>({ ...manufacturerInEu, manufacturerOutsideEu: false, safetyWarnings: 'Keep away from fire.' });
  });

  it('keeps an imported product with the manufacturer in the EU readable on create and on update', async () => {
    const repository = createImportContentRepository(db);
    const id = 'rollback-imported';

    expect(await repository.commit(TENANT, { kind: 'product', action: 'created', resource: product(id, manufacturerInEu), event: importEvent(id, 'a', 'created') })).toBe('saved');
    expect(previousReleaseComplianceSchema.safeParse(await storedCompliance(id)).success).toBe(true);

    expect(await repository.commit(TENANT, { kind: 'product', action: 'updated', resource: product(id, manufacturerInEu, 'Imported, updated'), event: importEvent(id, 'b', 'updated') })).toBe('saved');
    expect(previousReleaseComplianceSchema.safeParse(await storedCompliance(id)).success).toBe(true);
  });

  it('stores the switch and the responsible person when the manufacturer is outside the EU, which the previous release cannot read', async () => {
    const repository = createProductRepository(db);
    const outside = product('rollback-outside-eu', manufacturerOutsideEu);

    expect(await repository.create(TENANT, outside)).toBe('created');
    expect(await storedCompliance(outside.id)).toEqual(manufacturerOutsideEu);
    expect(previousReleaseComplianceSchema.safeParse(await storedCompliance(outside.id)).success).toBe(false);
  });
});
