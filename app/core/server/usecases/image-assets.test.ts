import { describe, expect, it } from 'vitest';

import {
  IMAGE_ASSET_MAX_BYTES,
  err,
  integrationUnavailable,
  notFound,
  ok,
  type Identity,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { StorageProvider } from '../ports.js';
import {
  IMAGE_ASSET_GET_TTL_SECONDS,
  beginImageAssetUpload,
  completeImageAssetUpload,
  getPublicImageAssetUrl,
  type ImageAssetDeps,
} from './image-assets.js';

const TENANT_ID = 'tenant-1';
const ASSET_ID = '00000000-0000-4000-8000-000000000001';
const NOW = '2026-08-16T12:00:00.000Z';

const identity = (staffRole: Identity['staffRole'], memberId: string | null): Identity => ({
  userId: staffRole === null ? 'user-1' : `${staffRole}-1`,
  email: 'person@example.test',
  name: 'Person',
  emailVerified: true,
  tenantId: TENANT_ID,
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole,
  memberId,
  memberBannedAt: null,
});

const ownerCtx: Ctx = { identity: identity('owner', null) };
const adminCtx: Ctx = { identity: identity('admin', null) };
const memberCtx: Ctx = { identity: identity(null, 'member-1') };
const authenticatedCtx: Ctx = { identity: identity(null, null) };

const storageConfiguration = JSON.stringify({
  provider: 'minio',
  endpoint: 'https://storage.example.test',
  region: 'eu-central-1',
  bucket: 'private-assets',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
});

const testDeps = (sizeBytes = 1024) => {
  const signed: Array<{ method: 'GET' | 'PUT'; url: string; expiresInSeconds: number }> = [];
  const removed: string[] = [];
  const storage: StorageProvider = {
    objectUrl: (configuration, key) => new URL(`${configuration.endpoint}/${configuration.bucket}/${key}`),
    probe: async () => ok({ code: 'storage.available', message: 'ok' }),
    presignPut: (input) => {
      signed.push({ method: 'PUT', url: input.url, expiresInSeconds: input.expiresInSeconds });
      return ok(`${input.url}?signed=put`);
    },
    presignGet: (input) => {
      signed.push({ method: 'GET', url: input.url, expiresInSeconds: input.expiresInSeconds });
      return ok(`${input.url}&signed=get`);
    },
    delete: async (input) => {
      removed.push(input.url);
      return ok({ deleted: true });
    },
    head: async () => ok({ sizeBytes }),
    healthcheck: async () => ok({ healthy: true }),
    test: async () => ok({ code: 'storage.available', message: 'ok' }),
  };
  const deps: ImageAssetDeps = {
    storage,
    secretResolver: { resolve: async () => ok(storageConfiguration) },
    ids: { nextId: () => ASSET_ID },
    clock: { nowIso: () => NOW },
  };
  return { deps, removed, signed };
};

describe('image assets', () => {
  it.each([
    ['course-cover', adminCtx],
    ['product-cover', adminCtx],
    ['logo', ownerCtx],
    ['favicon', ownerCtx],
  ] as const)('begins an authorized %s upload with a tenant-scoped key', async (kind, ctx) => {
    const { deps, signed } = testDeps();
    const result = await beginImageAssetUpload(ctx, {
      kind,
      fileName: 'cover.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
    }, deps);

    expect(result).toMatchObject({
      ok: true,
      value: {
        key: `image-assets/${TENANT_ID}/${kind}/${ASSET_ID}.jpg`,
        servePath: `/api/public/assets/${kind}/${ASSET_ID}.jpg`,
      },
    });
    expect(signed).toEqual([expect.objectContaining({ method: 'PUT' })]);
  });

  it.each([memberCtx, authenticatedCtx])('rejects non-staff upload callers', async (ctx) => {
    const { deps, signed } = testDeps();
    const result = await beginImageAssetUpload(ctx, {
      kind: 'course-cover',
      fileName: 'cover.png',
      contentType: 'image/png',
      sizeBytes: 1024,
    }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(signed).toEqual([]);
  });

  it('keeps branding uploads owner-only', async () => {
    const { deps } = testDeps();
    const result = await beginImageAssetUpload(adminCtx, {
      kind: 'logo',
      fileName: 'logo.svg',
      contentType: 'image/svg+xml',
      sizeBytes: 1024,
    }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it.each([
    [{ kind: 'course-cover', fileName: 'cover.ico', contentType: 'image/x-icon', sizeBytes: 1024 }],
    [{ kind: 'course-cover', fileName: 'cover.png', contentType: 'image/png', sizeBytes: IMAGE_ASSET_MAX_BYTES + 1 }],
  ] as const)('rejects an invalid content type or size', async (input) => {
    const { deps, signed } = testDeps();
    const result = await beginImageAssetUpload(ownerCtx, input, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(signed).toEqual([]);
  });

  it('reports missing storage configuration before signing', async () => {
    const { deps, signed } = testDeps();
    deps.secretResolver = { resolve: async () => err(notFound('missing')) };
    const result = await beginImageAssetUpload(ownerCtx, {
      kind: 'favicon',
      fileName: 'favicon.ico',
      contentType: 'image/x-icon',
      sizeBytes: 1024,
    }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'integration_not_configured' } });
    expect(signed).toEqual([]);
  });

  it.each([
    `image-assets/tenant-2/course-cover/${ASSET_ID}.png`,
    `product-downloads/${TENANT_ID}/course-cover/${ASSET_ID}.png`,
  ])('rejects a foreign completion key', async (key) => {
    const { deps } = testDeps();
    const result = await completeImageAssetUpload(ownerCtx, { key }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('deletes an oversized object during completion', async () => {
    const { deps, removed } = testDeps(IMAGE_ASSET_MAX_BYTES + 1);
    const key = `image-assets/${TENANT_ID}/product-cover/${ASSET_ID}.webp`;
    const result = await completeImageAssetUpload(ownerCtx, { key }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(removed).toHaveLength(1);
  });

  it('signs a public tenant image with its response content type', async () => {
    const { deps, signed } = testDeps();
    const result = await getPublicImageAssetUrl(TENANT_ID, {
      kind: 'course-cover',
      file: `${ASSET_ID}.webp`,
    }, deps);

    expect(result).toMatchObject({ ok: true });
    expect(signed).toEqual([expect.objectContaining({
      method: 'GET',
      expiresInSeconds: IMAGE_ASSET_GET_TTL_SECONDS,
    })]);
    expect(signed[0]?.url).toContain(`image-assets/${TENANT_ID}/course-cover/${ASSET_ID}.webp`);
    expect(signed[0]?.url).toContain('response-content-type=image%2Fwebp');
  });

  it.each([
    { kind: 'lesson-attachment', file: `${ASSET_ID}.png` },
    { kind: 'logo', file: '../product-downloads/file.png' },
    { kind: 'favicon', file: `${ASSET_ID}.gif` },
  ])('returns not found for invalid public parameters', async (input) => {
    const { deps, signed } = testDeps();
    const result = await getPublicImageAssetUrl(TENANT_ID, input, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(signed).toEqual([]);
  });

  it('normalizes storage configuration and signing failures to not found', async () => {
    const { deps } = testDeps();
    deps.secretResolver = { resolve: async () => err(notFound('private bucket detail')) };
    const unconfigured = await getPublicImageAssetUrl(TENANT_ID, {
      kind: 'logo',
      file: `${ASSET_ID}.svg`,
    }, deps);
    deps.secretResolver = { resolve: async () => ok(storageConfiguration) };
    deps.storage.presignGet = () => err(integrationUnavailable('bucket returned 403'));
    const rejected = await getPublicImageAssetUrl(TENANT_ID, {
      kind: 'logo',
      file: `${ASSET_ID}.svg`,
    }, deps);

    expect(unconfigured).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(rejected).toMatchObject({ ok: false, error: { code: 'not_found' } });
    if (!rejected.ok) expect(rejected.error.message).not.toContain('403');
  });
});
