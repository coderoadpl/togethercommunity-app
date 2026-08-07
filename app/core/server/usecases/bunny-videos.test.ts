import { describe, expect, it } from 'vitest';

import type { Identity, StaffRole, StreamVideo, TenantSettings } from '#core/domain/index.js';
import { err, integrationAuth, integrationUnavailable, notFound, ok } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { TenantRepository, TenantSecretResolver, VideoLibraryPort } from '../ports.js';
import { BUNNY_VIDEOS_PER_PAGE, listBunnyVideos, testBunnyConnection, type BunnyVideosDeps } from './bunny-videos.js';

const ctx = (staffRole: StaffRole | null, tenantId: string | null = 't1'): Ctx => ({
  identity: {
    userId: 'u1',
    email: 'owner@together.dev',
    name: 'Owner',
    emailVerified: true,
    tenantId,
    tenantSlug: tenantId ? 'acme' : null,
    tenantName: tenantId ? 'Acme' : null,
    staffRole,
    memberId: null,
  memberBannedAt: null,
  } satisfies Identity,
});

const video = (id: string): StreamVideo => ({
  id,
  title: `Video ${id}`,
  lengthSeconds: 120,
  uploadedAt: '2026-07-01T10:00:00.000Z',
});

interface HarnessOptions {
  apiKey?: string | null;
  settings?: TenantSettings | null;
  listVideos?: VideoLibraryPort['listVideos'];
}

interface Harness {
  deps: BunnyVideosDeps;
  calls: Array<Parameters<VideoLibraryPort['listVideos']>[0]>;
}

const harness = (options: HarnessOptions = {}): Harness => {
  const apiKey = options.apiKey === undefined ? 'bunny-key-1234' : options.apiKey;
  const settings =
    options.settings === undefined
      ? {
          name: 'Acme', socialLinks: [],
          billingPortalUrl: null, bunnyStreamLibraryId: 'lib-77', bunnyStreamCdnHostname: null, logoUrl: null,
          accentColor: null, faviconUrl: null, ogTitle: null, ogDescription: null,
          ogImageUrl: null, supportEmail: null, supportUrl: null, termsUrl: null,
          privacyUrl: null,
        }
      : options.settings;
  const calls: Harness['calls'] = [];
  const tenants: TenantRepository = {
    findById: async () => null,
    findBySlug: async () => null,
    findSole: async () => null,
    hasAny: async () => false,
    findSettings: async () => settings,
    updateSettings: async (_tenantId, next) => next,
    createTenantWithOwnerGrant: async () => {
      throw new Error('not used');
    },
  };
  const secretResolver: TenantSecretResolver = {
    resolve: async (_tenantId, key) =>
      apiKey === null ? err(notFound(`No "${key}" secret is configured for this tenant`)) : ok(apiKey),
  };
  const videoLibrary: VideoLibraryPort = {
    listVideos: async (input) => {
      calls.push(input);
      if (options.listVideos) return options.listVideos(input);
      return ok({ videos: [video('v1'), video('v2')], totalItems: 2 });
    },
  };
  return { deps: { tenants, secretResolver, videoLibrary }, calls };
};

describe('listBunnyVideos', () => {
  it('lists videos for an admin with the decrypted key and configured library', async () => {
    const h = harness();
    const result = await listBunnyVideos(ctx('admin'), { search: 'intro', page: 2 }, h.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.libraryId).toBe('lib-77');
    expect(result.value.page).toBe(2);
    expect(result.value.totalItems).toBe(2);
    expect(result.value.videos.map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(h.calls).toEqual([
      { apiKey: 'bunny-key-1234', libraryId: 'lib-77', search: 'intro', page: 2, perPage: BUNNY_VIDEOS_PER_PAGE },
    ]);
  });

  it('reports integration_not_configured when no API key is stored, without calling Bunny', async () => {
    const h = harness({ apiKey: null });
    const result = await listBunnyVideos(ctx('owner'), {}, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'integration_not_configured' } });
    expect(h.calls).toHaveLength(0);
  });

  it('reports integration_not_configured when no library id is set, without calling Bunny', async () => {
    const h = harness({ settings: {
      name: 'Acme', socialLinks: [],
      billingPortalUrl: null, bunnyStreamLibraryId: null, bunnyStreamCdnHostname: null, logoUrl: null,
      accentColor: null, faviconUrl: null, ogTitle: null, ogDescription: null,
      ogImageUrl: null, supportEmail: null, supportUrl: null, termsUrl: null,
      privacyUrl: null,
    } });
    const result = await listBunnyVideos(ctx('owner'), {}, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'integration_not_configured' } });
    expect(h.calls).toHaveLength(0);
  });

  it('passes through the integration_auth error when Bunny rejects the key', async () => {
    const h = harness({
      listVideos: async () => err(integrationAuth('Bunny Stream rejected the API key')),
    });
    const result = await listBunnyVideos(ctx('owner'), {}, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'integration_auth' } });
  });

  it('passes through the integration_unavailable error when Bunny is unreachable', async () => {
    const h = harness({
      listVideos: async () => err(integrationUnavailable('Bunny Stream is unreachable')),
    });
    const result = await listBunnyVideos(ctx('owner'), {}, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
  });

  it('forbids a non-staff caller', async () => {
    const h = harness();
    const result = await listBunnyVideos(ctx(null), {}, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.calls).toHaveLength(0);
  });

  it('requires a selected tenant', async () => {
    const h = harness();
    const result = await listBunnyVideos(ctx('owner', null), {}, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });
});

describe('testBunnyConnection', () => {
  it('reports a diagnostic with the video count for the owner', async () => {
    const h = harness();
    const result = await testBunnyConnection(ctx('owner'), h.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostic).toContain('lib-77');
    expect(result.value.diagnostic).toContain('2 video(s)');
    expect(h.calls).toEqual([
      { apiKey: 'bunny-key-1234', libraryId: 'lib-77', search: null, page: 1, perPage: 1 },
    ]);
  });

  it('mentions an empty library so the owner knows the key works', async () => {
    const h = harness({ listVideos: async () => ok({ videos: [], totalItems: 0 }) });
    const result = await testBunnyConnection(ctx('owner'), h.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostic).toContain('no videos');
  });

  it('forbids an admin from testing', async () => {
    const h = harness();
    const result = await testBunnyConnection(ctx('admin'), h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('reports integration_not_configured when no key is stored', async () => {
    const h = harness({ apiKey: null });
    const result = await testBunnyConnection(ctx('owner'), h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'integration_not_configured' } });
  });
});
