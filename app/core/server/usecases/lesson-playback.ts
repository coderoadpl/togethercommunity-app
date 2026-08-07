import { ok, type AppError, type Result } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type { BunnyTokenSigner, TenantRepository, TenantSecretResolver } from '../ports.js';
import { getAccessibleLesson, type CourseAccessDeps } from './entitlements.js';

export interface LessonPlaybackDeps extends CourseAccessDeps {
  tenants: TenantRepository;
  secretResolver: TenantSecretResolver;
  bunnyTokenSigner: BunnyTokenSigner;
  playbackTokenTtlSeconds: number;
}

export const DEFAULT_PLAYBACK_TOKEN_TTL_SECONDS = 21_600;

type PlaybackVideo =
  | {
      kind: 'bunny';
      storageKey: string;
      videoId: string;
      libraryId: string;
      embedUrl: string;
      hlsUrl: string | null;
      signed: boolean;
    }
  | { kind: 'external'; embedUrl: string }
  | { kind: 'unavailable'; storageKey: string; reason: 'missing_library_id' };

interface LessonPlaybackOutput {
  lessonId: string;
  expiresAt: string;
  videos: PlaybackVideo[];
}

export const getLessonPlayback = async (
  ctx: Ctx,
  lessonId: string,
  deps: LessonPlaybackDeps,
): Promise<Result<LessonPlaybackOutput, AppError>> => {
  const tenant = authorizeTenant(ctx, 'lesson:play');
  if (!tenant.ok) return tenant;
  const lesson = await getAccessibleLesson(ctx, lessonId, deps);
  if (!lesson.ok) return lesson;

  const blocks = lesson.value.contents.filter(
    (block) => block.type === 'video' || block.type === 'embed',
  );
  const tenantId = ctx.identity.tenantId;
  const hasBunnyBlock = blocks.some(
    (block) => block.type === 'video' && block.streamLibraryId !== undefined,
  );
  let securityKey: string | null = null;
  let cdnHostname: string | null = null;

  if (hasBunnyBlock && tenantId !== null) {
    const resolved = await deps.secretResolver.resolve(tenantId, 'bunny.securityKey');
    if (!resolved.ok && resolved.error.code !== 'not_found') return resolved;
    securityKey = resolved.ok ? resolved.value : null;
    const settings = await deps.tenants.findSettings(tenantId);
    cdnHostname = settings?.bunnyStreamCdnHostname ?? null;
  }

  const expires = Math.floor(Date.parse(deps.clock.nowIso()) / 1000) + deps.playbackTokenTtlSeconds;
  const videos = blocks.map((block): PlaybackVideo => {
    if (block.type === 'embed') return { kind: 'external', embedUrl: block.embedUrl };
    if (block.streamLibraryId === undefined) {
      return {
        kind: 'unavailable',
        storageKey: block.storageKey,
        reason: 'missing_library_id',
      };
    }

    const embedUrl = new URL(
      `https://iframe.mediadelivery.net/embed/${block.streamLibraryId}/${block.streamVideoId}`,
    );
    if (securityKey === null) {
      return {
        kind: 'bunny',
        storageKey: block.storageKey,
        videoId: block.streamVideoId,
        libraryId: block.streamLibraryId,
        embedUrl: embedUrl.toString(),
        hlsUrl: null,
        signed: false,
      };
    }

    embedUrl.searchParams.set('token', deps.bunnyTokenSigner.signEmbedToken({
      securityKey,
      videoId: block.streamVideoId,
      expires,
    }));
    embedUrl.searchParams.set('expires', String(expires));
    return {
      kind: 'bunny',
      storageKey: block.storageKey,
      videoId: block.streamVideoId,
      libraryId: block.streamLibraryId,
      embedUrl: embedUrl.toString(),
      hlsUrl: cdnHostname === null
        ? null
        : deps.bunnyTokenSigner.signHlsPlaylistUrl({
            securityKey,
            cdnHostname,
            videoId: block.streamVideoId,
            expires,
          }),
      signed: true,
    };
  });

  return ok({
    lessonId: lesson.value.id,
    expiresAt: new Date(expires * 1000).toISOString(),
    videos,
  });
};
