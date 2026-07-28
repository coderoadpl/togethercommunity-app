import {
  ok,
  type AppError,
  type LessonBlock,
  type PlayableCourseLesson,
  type PlayableLessonBlock,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { BunnyEmbedTokenSigner, FileUrlSigner, TenantSecretResolver } from '../ports.js';
import { getAccessibleLesson, type CourseAccessDeps } from './entitlements.js';

export interface PlayableLessonDeps extends CourseAccessDeps {
  secretResolver: TenantSecretResolver;
  fileUrlSigner: FileUrlSigner;
  bunnyEmbedTokenSigner: BunnyEmbedTokenSigner;
}

export const PDF_URL_TTL_SECONDS = 3600;
export const BUNNY_EMBED_URL_TTL_SECONDS = 3600;

const S3_HOST_PATTERN = /^[a-z0-9][a-z0-9.-]*\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/;

const isS3Url = (raw: string): boolean => {
  try {
    return S3_HOST_PATTERN.test(new URL(raw).hostname);
  } catch {
    return false;
  }
};

const needsPdfSigning = (block: LessonBlock): boolean =>
  block.type === 'pdf' && isS3Url(block.pdfUrl);

const bunnyEmbedUrl = (block: Extract<LessonBlock, { type: 'video' }>): string | null =>
  block.streamLibraryId === undefined
    ? null
    : `https://iframe.mediadelivery.net/embed/${block.streamLibraryId}/${block.streamVideoId}`;

const signBunnyEmbedUrl = (
  block: Extract<LessonBlock, { type: 'video' }>,
  securityKey: string,
  expires: number,
  signer: BunnyEmbedTokenSigner,
): string | null => {
  const rawUrl = bunnyEmbedUrl(block);
  if (rawUrl === null) return null;
  const token = signer.sign({ securityKey, videoId: block.streamVideoId, expires });
  const url = new URL(rawUrl);
  url.searchParams.set('token', token);
  url.searchParams.set('expires', String(expires));
  return url.toString();
};

/**
 * The member-facing lesson read: entitlement-checked content with S3-hosted
 * PDF pointers exchanged for short-lived presigned URLs, because imported
 * legacy documents live on a private bucket that rejects anonymous reads.
 * Tenants without stored S3 credentials get the blocks untouched.
 */
export const getPlayableLesson = async (
  ctx: Ctx,
  lessonId: string,
  deps: PlayableLessonDeps,
): Promise<Result<PlayableCourseLesson, AppError>> => {
  const lesson = await getAccessibleLesson(ctx, lessonId, deps);
  if (!lesson.ok) return lesson;
  const tenantId = ctx.identity.tenantId;
  if (tenantId === null) return lesson;

  let contents: PlayableLessonBlock[] = lesson.value.contents;
  if (contents.some((block) => block.type === 'video' && bunnyEmbedUrl(block) !== null)) {
    const securityKey = await deps.secretResolver.resolve(tenantId, 'bunny.securityKey');
    if (!securityKey.ok && securityKey.error.code !== 'not_found') return securityKey;
    if (securityKey.ok) {
      const expires = Math.floor(Date.parse(deps.clock.nowIso()) / 1000) + BUNNY_EMBED_URL_TTL_SECONDS;
      contents = contents.map((block): PlayableLessonBlock => {
        if (block.type !== 'video') return block;
        const embedUrl = signBunnyEmbedUrl(block, securityKey.value, expires, deps.bunnyEmbedTokenSigner);
        return embedUrl === null ? block : { ...block, embedUrl };
      });
    }
  }

  if (!contents.some(needsPdfSigning)) {
    return contents === lesson.value.contents ? lesson : ok({ ...lesson.value, contents });
  }

  const accessKeyId = await deps.secretResolver.resolve(tenantId, 's3.accessKeyId');
  if (!accessKeyId.ok) {
    return accessKeyId.error.code === 'not_found' ? ok({ ...lesson.value, contents }) : accessKeyId;
  }
  const secretAccessKey = await deps.secretResolver.resolve(tenantId, 's3.secretAccessKey');
  if (!secretAccessKey.ok) {
    return secretAccessKey.error.code === 'not_found' ? ok({ ...lesson.value, contents }) : secretAccessKey;
  }

  contents = contents.map((block): PlayableLessonBlock => {
    if (!needsPdfSigning(block) || block.type !== 'pdf') return block;
    const signed = deps.fileUrlSigner.presignGet({
      url: block.pdfUrl,
      accessKeyId: accessKeyId.value,
      secretAccessKey: secretAccessKey.value,
      expiresInSeconds: PDF_URL_TTL_SECONDS,
    });
    return signed.ok ? { ...block, pdfUrl: signed.value } : block;
  });
  return ok({ ...lesson.value, contents });
};
