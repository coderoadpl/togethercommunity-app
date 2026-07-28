import {
  err,
  integrationNotConfigured,
  listStreamVideosInputSchema,
  ok,
  validation,
  type AppError,
  type ListStreamVideosInput,
  type Result,
  type StreamVideoPage,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type { TenantRepository, TenantSecretResolver, VideoLibraryPort } from '../ports.js';

export interface BunnyVideosDeps {
  tenants: TenantRepository;
  secretResolver: TenantSecretResolver;
  videoLibrary: VideoLibraryPort;
}

export const BUNNY_VIDEOS_PER_PAGE = 24;

const resolveBunnyConfig = async (
  tenantId: string,
  deps: BunnyVideosDeps,
): Promise<Result<{ apiKey: string; libraryId: string }, AppError>> => {
  const apiKey = await deps.secretResolver.resolve(tenantId, 'bunny.apiKey');
  if (!apiKey.ok) {
    if (apiKey.error.code === 'not_found') {
      return err(integrationNotConfigured('Save a Bunny Stream API key in Integrations first'));
    }
    return apiKey;
  }
  const settings = await deps.tenants.findSettings(tenantId);
  const libraryId = settings?.bunnyStreamLibraryId ?? null;
  if (libraryId === null) {
    return err(integrationNotConfigured('Set the Bunny Stream library id in Integrations first'));
  }
  return ok({ apiKey: apiKey.value, libraryId });
};

export const listBunnyVideos = async (
  ctx: Ctx,
  input: ListStreamVideosInput,
  deps: BunnyVideosDeps,
): Promise<Result<StreamVideoPage, AppError>> => {
  const tenant = authorizeTenant(ctx, 'course:read');
  if (!tenant.ok) return tenant;
  const parsed = listStreamVideosInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid video listing query', parsed.error.flatten()));
  const config = await resolveBunnyConfig(tenant.value, deps);
  if (!config.ok) return config;
  const listed = await deps.videoLibrary.listVideos({
    apiKey: config.value.apiKey,
    libraryId: config.value.libraryId,
    search: parsed.data.search === undefined || parsed.data.search === '' ? null : parsed.data.search,
    page: parsed.data.page,
    perPage: BUNNY_VIDEOS_PER_PAGE,
  });
  if (!listed.ok) return listed;
  return ok({
    libraryId: config.value.libraryId,
    videos: listed.value.videos,
    totalItems: listed.value.totalItems,
    page: parsed.data.page,
    pageSize: BUNNY_VIDEOS_PER_PAGE,
  });
};

export const testBunnyConnection = async (
  ctx: Ctx,
  deps: BunnyVideosDeps,
): Promise<Result<{ ok: true; diagnostic: string }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'integration:test');
  if (!tenant.ok) return tenant;
  const config = await resolveBunnyConfig(tenant.value, deps);
  if (!config.ok) return config;
  const listed = await deps.videoLibrary.listVideos({
    apiKey: config.value.apiKey,
    libraryId: config.value.libraryId,
    search: null,
    page: 1,
    perPage: 1,
  });
  if (!listed.ok) return listed;
  const diagnostic =
    listed.value.totalItems === 0
      ? `Bunny Stream accepted the API key. Library ${config.value.libraryId} is reachable but contains no videos yet.`
      : `Bunny Stream accepted the API key. Library ${config.value.libraryId} contains ${listed.value.totalItems} video(s).`;
  return ok({ ok: true, diagnostic });
};
