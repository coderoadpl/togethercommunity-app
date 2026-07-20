import {
  ok,
  type AppError,
  type CourseLesson,
  type LessonBlock,
  type Result,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type { FileUrlSigner, TenantSecretResolver } from '../ports.js';
import { getAccessibleLesson, type CourseAccessDeps } from './entitlements.js';

export interface PlayableLessonDeps extends CourseAccessDeps {
  secretResolver: TenantSecretResolver;
  fileUrlSigner: FileUrlSigner;
}

export const PDF_URL_TTL_SECONDS = 3600;

const S3_HOST_PATTERN = /^[a-z0-9][a-z0-9.-]*\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/;

const isS3Url = (raw: string): boolean => {
  try {
    return S3_HOST_PATTERN.test(new URL(raw).hostname);
  } catch {
    return false;
  }
};

const needsSigning = (block: LessonBlock): boolean =>
  block.type === 'pdf' && isS3Url(block.pdfUrl);

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
): Promise<Result<CourseLesson, AppError>> => {
  const lesson = await getAccessibleLesson(ctx, lessonId, deps);
  if (!lesson.ok) return lesson;
  const tenantId = ctx.identity.tenantId;
  if (tenantId === null || !lesson.value.contents.some(needsSigning)) return lesson;

  const accessKeyId = await deps.secretResolver.resolve(tenantId, 's3.accessKeyId');
  if (!accessKeyId.ok) {
    return accessKeyId.error.code === 'not_found' ? lesson : accessKeyId;
  }
  const secretAccessKey = await deps.secretResolver.resolve(tenantId, 's3.secretAccessKey');
  if (!secretAccessKey.ok) {
    return secretAccessKey.error.code === 'not_found' ? lesson : secretAccessKey;
  }

  const contents = lesson.value.contents.map((block): LessonBlock => {
    if (!needsSigning(block) || block.type !== 'pdf') return block;
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
