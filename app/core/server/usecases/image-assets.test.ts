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
  beginBrandingAssetUpload,
  beginAvatarUpload,
  beginCourseCoverUpload,
  beginProductCoverUpload,
  completeBrandingAssetUpload,
  completeAvatarUpload,
  completeCourseCoverUpload,
  completeProductCoverUpload,
  getPublicImageAssetUrl,
  importGoogleAvatar,
  removeAvatar,
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
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
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
    probeCors: async (_configuration, origins) => origins.map((origin) => ({ origin, status: 'ok' })),
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
  it('processes a member avatar to a 256px WebP path before storing it on the account', async () => {
    const { deps, removed } = testDeps();
    const images: Array<{ sourceKey: string; targetKey: string }> = [];
    const stored: string[] = [];
    const previous = '/api/public/assets/avatar/00000000-0000-4000-8000-000000000002.webp';
    const avatarDeps = {
      ...deps,
      avatars: {
        findState: async () => ({ image: previous, canImport: false }),
        setAvatar: async (_tenantId: string, _userId: string, image: string) => {
          stored.push(image);
        },
        setAvatarIfMissing: async () => true,
        removeAvatar: async () => undefined,
      },
      avatarImages: {
        processStored: async (input: { sourceKey: string; targetKey: string }) => {
          images.push(input);
          return ok(undefined);
        },
        importRemote: async () => ok(undefined),
      },
    };
    const started = await beginAvatarUpload(memberCtx, {
      kind: 'avatar',
      fileName: 'portrait.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
    }, avatarDeps);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    await expect(completeAvatarUpload(memberCtx, { key: started.value.key }, avatarDeps))
      .resolves.toEqual(ok({ url: `/api/public/assets/avatar/${ASSET_ID}.webp` }));
    expect(images).toMatchObject([{
      sourceKey: `image-assets/${TENANT_ID}/avatar/${ASSET_ID}.jpg`,
      targetKey: `image-assets/${TENANT_ID}/avatar/${ASSET_ID}.webp`,
    }]);
    expect(stored).toEqual([`/api/public/assets/avatar/${ASSET_ID}.webp`]);
    expect(removed).toContain(
      'https://storage.example.test/private-assets/image-assets/tenant-1/avatar/00000000-0000-4000-8000-000000000002.webp',
    );
  });

  it('removes the account avatar without accepting an arbitrary replacement URL', async () => {
    const { deps, removed } = testDeps();
    const stored: string[] = [];
    const previous = '/api/public/assets/avatar/00000000-0000-4000-8000-000000000002.webp';
    const result = await removeAvatar(memberCtx, {
      ...deps,
      avatars: {
        findState: async () => ({ image: previous, canImport: false }),
        setAvatar: async (_tenantId, _userId, image) => {
          stored.push(image);
        },
        setAvatarIfMissing: async () => true,
        removeAvatar: async () => {
          stored.push('removed');
        },
      },
    });

    expect(result).toEqual(ok({ removed: true }));
    expect(stored).toEqual(['removed']);
    expect(removed).toEqual([
      'https://storage.example.test/private-assets/image-assets/tenant-1/avatar/00000000-0000-4000-8000-000000000002.webp',
    ]);
  });

  it('imports a Google picture through the processor only while the avatar is missing', async () => {
    const { deps } = testDeps();
    const imported: string[] = [];
    const stored: string[] = [];
    let canImport = true;
    const avatarDeps = {
      ...deps,
      avatars: {
        findState: async () => ({ image: null, canImport }),
        setAvatar: async () => undefined,
        setAvatarIfMissing: async (_tenantId: string, _userId: string, image: string) => {
          stored.push(image);
          canImport = false;
          return true;
        },
        removeAvatar: async () => undefined,
      },
      avatarImages: {
        processStored: async () => ok(undefined),
        importRemote: async ({ sourceUrl }: { sourceUrl: string }) => {
          imported.push(sourceUrl);
          return ok(undefined);
        },
      },
    };
    const input = {
      tenantId: TENANT_ID,
      userId: 'user-1',
      sourceUrl: 'https://lh3.googleusercontent.com/a/photo',
    };
    await importGoogleAvatar(input, avatarDeps);
    await importGoogleAvatar(input, avatarDeps);

    expect(imported).toEqual(['https://lh3.googleusercontent.com/a/photo']);
    expect(stored).toEqual([`/api/public/assets/avatar/${ASSET_ID}.webp`]);
  });

  it('deletes a Google image when another avatar wins the conditional update', async () => {
    const { deps, removed } = testDeps();
    await importGoogleAvatar({
      tenantId: TENANT_ID,
      userId: 'user-1',
      sourceUrl: 'https://lh3.googleusercontent.com/a/photo',
    }, {
      ...deps,
      avatars: {
        findState: async () => ({ image: null, canImport: true }),
        setAvatar: async () => undefined,
        setAvatarIfMissing: async () => false,
        removeAvatar: async () => undefined,
      },
      avatarImages: {
        processStored: async () => ok(undefined),
        importRemote: async () => ok(undefined),
      },
    });

    expect(removed).toEqual([
      `https://storage.example.test/private-assets/image-assets/${TENANT_ID}/avatar/${ASSET_ID}.webp`,
    ]);
  });

  it.each([
    ['course-cover', adminCtx, beginCourseCoverUpload],
    ['product-cover', adminCtx, beginProductCoverUpload],
    ['logo', ownerCtx, beginBrandingAssetUpload],
    ['logo-dark', ownerCtx, beginBrandingAssetUpload],
    ['favicon', ownerCtx, beginBrandingAssetUpload],
    ['share-image', ownerCtx, beginBrandingAssetUpload],
  ] as const)('begins an authorized %s upload with a tenant-scoped key', async (kind, ctx, begin) => {
    const { deps, signed } = testDeps();
    const result = await begin(ctx, {
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
    const result = await beginCourseCoverUpload(ctx, {
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
    const result = await beginBrandingAssetUpload(adminCtx, {
      kind: 'logo',
      fileName: 'logo.svg',
      contentType: 'image/svg+xml',
      sizeBytes: 1024,
    }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it.each([
    ['logo', beginCourseCoverUpload],
    ['course-cover', beginBrandingAssetUpload],
    ['favicon', beginProductCoverUpload],
  ] as const)('rejects a %s upload on a use-case that does not accept it', async (kind, begin) => {
    const { deps, signed } = testDeps();
    const result = await begin(ownerCtx, {
      kind,
      fileName: 'asset.png',
      contentType: 'image/png',
      sizeBytes: 1024,
    }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(signed).toEqual([]);
  });

  it.each([
    ['logo', completeCourseCoverUpload],
    ['course-cover', completeBrandingAssetUpload],
    ['favicon', completeProductCoverUpload],
  ] as const)('rejects a stored %s key on a use-case that does not accept it', async (kind, complete) => {
    const { deps } = testDeps();
    const result = await complete(
      ownerCtx,
      { key: `image-assets/${TENANT_ID}/${kind}/${ASSET_ID}.png` },
      deps,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it.each([
    [{ kind: 'course-cover', fileName: 'cover.ico', contentType: 'image/x-icon', sizeBytes: 1024 }],
    [{ kind: 'course-cover', fileName: 'cover.png', contentType: 'image/png', sizeBytes: IMAGE_ASSET_MAX_BYTES + 1 }],
  ] as const)('rejects an invalid content type or size', async (input) => {
    const { deps, signed } = testDeps();
    const result = await beginCourseCoverUpload(ownerCtx, input, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(signed).toEqual([]);
  });

  it.each([
    ['image/svg+xml', 'share.svg'],
    ['image/x-icon', 'share.ico'],
  ] as const)('rejects a %s share image because crawlers cannot render it', async (contentType, fileName) => {
    const { deps, signed } = testDeps();
    const result = await beginBrandingAssetUpload(ownerCtx, {
      kind: 'share-image',
      fileName,
      contentType,
      sizeBytes: 1024,
    }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(signed).toEqual([]);
  });

  it('accepts a dark logo in SVG', async () => {
    const { deps } = testDeps();
    const result = await beginBrandingAssetUpload(ownerCtx, {
      kind: 'logo-dark',
      fileName: 'logo.svg',
      contentType: 'image/svg+xml',
      sizeBytes: 1024,
    }, deps);

    expect(result).toMatchObject({
      ok: true,
      value: { servePath: `/api/public/assets/logo-dark/${ASSET_ID}.svg` },
    });
  });

  it('reports missing storage configuration before signing', async () => {
    const { deps, signed } = testDeps();
    deps.secretResolver = { resolve: async () => err(notFound('missing')) };
    const result = await beginBrandingAssetUpload(ownerCtx, {
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
    const result = await completeCourseCoverUpload(ownerCtx, { key }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('deletes an oversized object during completion', async () => {
    const { deps, removed } = testDeps(IMAGE_ASSET_MAX_BYTES + 1);
    const key = `image-assets/${TENANT_ID}/product-cover/${ASSET_ID}.webp`;
    const result = await completeProductCoverUpload(ownerCtx, { key }, deps);

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
