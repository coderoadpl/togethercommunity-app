import { afterAll, describe, expect, it } from 'vitest';

import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretRepository } from '#adapters/db/repositories.js';
import { changeProposalDownloadDeletions, changeProposalImages, tenants } from '#adapters/db/schema.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { err, integrationUnavailable } from '#core/domain/index.js';
import type { StorageProvider } from '#core/server/index.js';
import { createObjectStorageFake } from '#core/server/testing/object-storage-fake.js';

import { createDeps } from './composition.js';
import { envSchema } from './env.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

let database: Awaited<ReturnType<typeof createTestDatabase>> | undefined;

afterAll(async () => {
  await database?.close();
});

describe('createDeps', () => {
  it('builds without a keepAlive hook', async () => {
    database = await createTestDatabase('together_composition_test', baseDatabaseUrl);
    const env = envSchema.parse({
      NODE_ENV: 'test',
      DATABASE_URL: database.url,
      REALTIME_TRANSPORT: 'in-process',
      APP_BASE_URL: 'http://localhost:48730',
      BETTER_AUTH_SECRET: 'composition-secret-at-least-32-characters',
    });

    const deps = createDeps(env, { db: database.db });

    expect(deps.auth.flushAuthEmails).toEqual(expect.any(Function));
    expect(deps.developmentCustomDomainPort).toBe(env.PORT);
    for (const appEnv of ['preview', 'staging', 'production']) {
      expect(createDeps({ ...env, APP_ENV: appEnv }, { db: database.db }).developmentCustomDomainPort).toBeUndefined();
    }
    expect(createDeps({ ...env, NODE_ENV: 'production' }, { db: database.db }).developmentCustomDomainPort).toBeUndefined();
    expect(createDeps({ ...env, APP_BASE_DOMAIN: 'together.test' }, { db: database.db }).developmentCustomDomainPort).toBeUndefined();
  });

  it('closes only the connections it opened itself', async () => {
    database ??= await createTestDatabase('together_composition_test', baseDatabaseUrl);
    const env = envSchema.parse({
      NODE_ENV: 'test',
      DATABASE_URL: database.url,
      DATABASE_POOL_MAX: '2',
      REALTIME_TRANSPORT: 'pg',
      APP_BASE_URL: 'http://localhost:48730',
      BETTER_AUTH_SECRET: 'composition-secret-at-least-32-characters',
    });

    const injected = createDeps(env, { db: database.db });
    await injected.close();
    expect(await injected.health.pingDatabase()).toBe(true);

    const owned = createDeps(env);
    expect(await owned.health.pingDatabase()).toBe(true);
    await owned.close();
    expect(await owned.health.pingDatabase()).toBe(false);
  });

  it('gives the image sweep and the file sweep of a tick each its own time budget, so deletes that use up one leave the other its own', async () => {
    database ??= await createTestDatabase('together_composition_test', baseDatabaseUrl);
    const env = envSchema.parse({
      NODE_ENV: 'test',
      DATABASE_URL: database.url,
      REALTIME_TRANSPORT: 'in-process',
      APP_BASE_URL: 'http://localhost:48730',
      BETTER_AUTH_SECRET: 'composition-secret-at-least-32-characters',
    });
    const now = '2026-03-01T10:00:00.000Z';
    const clock = { now };
    await database.db.insert(tenants).values({ id: 'acme', slug: 'acme', name: 'Acme', createdAt: now });
    await createTenantSecretRepository(database.db).upsert('acme', {
      id: 'acme-storage', tenantId: 'acme', key: 's3.configuration', maskedPreview: 'configured', updatedAt: now,
      ...createSecretCrypto(env.SECRETS_MASTER_KEY).encrypt(JSON.stringify({
        provider: 'aws_s3', endpoint: 'https://storage.example.test', region: 'auto', bucket: 'assets', accessKeyId: 'a', secretAccessKey: 's',
      })),
    });
    await database.db.insert(changeProposalImages).values([1, 2, 3, 4, 5].map((index) => ({
      tenantId: 'acme', apiKeyId: 'key-acme', kind: 'product-cover' as const, digest: index.toString(16).padStart(64, '0'), extension: 'png' as const,
      sizeBytes: 10, createdAt: now, releasedAt: now,
    })));
    await database.db.insert(changeProposalDownloadDeletions).values([1, 2, 3, 4, 5].map((index) => ({
      tenantId: 'acme', objectKey: `acme/product-downloads/key-files/key-acme/owed-${String(index)}/f.pdf`, apiKeyId: 'key-acme', sizeBytes: 10, createdAt: now,
    })));
    const objects = createObjectStorageFake();
    const deadlines: Record<'images' | 'files', number[]> = { images: [], files: [] };
    const storage: StorageProvider = {
      ...objects.storage,
      delete: async (input) => {
        deadlines[input.url.includes('/key-files/') ? 'files' : 'images'].push(input.deadlineMs ?? 0);
        clock.now = new Date(Date.parse(clock.now) + 4_000).toISOString();
        return err(integrationUnavailable('Could not reach S3.: the storage request deadline passed'));
      },
    };
    const deps = createDeps(env, { db: database.db, clock: { nowIso: () => clock.now }, storage });
    const tick = { deadlineAt: Date.parse(now) + 55_000 };

    expect(await deps.sweepQuarantinedImages(tick)).toEqual({ ok: true, value: { tenants: 1, removed: 0, failed: 0 } });
    expect(await deps.sweepKeyDownloadFiles(tick)).toEqual({ ok: true, value: { tenants: 1, removed: 0, failed: 0 } });
    expect(deadlines).toEqual({ images: [5_000, 5_000, 2_000], files: [10_000, 6_000, 2_000] });
    expect(Date.parse(clock.now) - Date.parse(now)).toBe(24_000);

    await deps.sweepQuarantinedImages(tick);
    await deps.sweepKeyDownloadFiles(tick);
    expect(deadlines.images.length + deadlines.files.length).toBe(6);
    await deps.close();
  });
});
