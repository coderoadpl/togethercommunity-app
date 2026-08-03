import {
  LESSON_ATTACHMENT_MAX_BYTES,
  err,
  integrationNotConfigured,
  lessonAttachmentUploadInputSchema,
  notFound,
  ok,
  storageConfigurationSchema,
  validation,
  type AppError,
  type LessonAttachment,
  type LessonAttachmentUploadInput,
  type Result,
  type StorageConfiguration,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  Clock,
  CourseLessonRepository,
  IdGenerator,
  LessonAttachmentRepository,
  StorageProvider,
  TenantSecretResolver,
} from '../ports.js';
import { getAccessibleLesson, type CourseAccessDeps } from './entitlements.js';

export const ATTACHMENT_UPLOAD_TTL_SECONDS = 15 * 60;
export const ATTACHMENT_DOWNLOAD_TTL_SECONDS = 60 * 60;

export interface LessonAttachmentDeps {
  attachments: LessonAttachmentRepository;
  lessons: CourseLessonRepository;
  storage: StorageProvider;
  secretResolver: TenantSecretResolver;
  ids: IdGenerator;
  clock: Clock;
}

export interface MemberLessonAttachmentDeps extends LessonAttachmentDeps, CourseAccessDeps {}

const resolveStorageConfiguration = async (
  tenantId: string,
  secretResolver: TenantSecretResolver,
): Promise<Result<StorageConfiguration, AppError>> => {
  const stored = await secretResolver.resolve(tenantId, 's3.configuration');
  if (!stored.ok) {
    return stored.error.code === 'not_found'
      ? err(integrationNotConfigured('Storage is not configured.'))
      : stored;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(stored.value);
  } catch {
    return err(integrationNotConfigured('The stored storage configuration is invalid.'));
  }
  const parsed = storageConfigurationSchema.safeParse(decoded);
  return parsed.success
    ? ok(parsed.data)
    : err(integrationNotConfigured('The stored storage configuration is invalid.'));
};

const storageFileName = (fileName: string): string => {
  const normalized = fileName
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-120);
  return normalized.length > 0 ? normalized : 'attachment';
};

const expiresAt = (nowIso: string, ttlSeconds: number): string =>
  new Date(Date.parse(nowIso) + ttlSeconds * 1000).toISOString();

const requireLesson = async (
  tenantId: string,
  lessonId: string,
  lessons: CourseLessonRepository,
): Promise<Result<undefined, AppError>> => {
  const lesson = await lessons.findById(tenantId, lessonId);
  return lesson === null
    ? err(notFound(`No lesson "${lessonId}" in this tenant`))
    : ok(undefined);
};

export const beginLessonAttachmentUpload = async (
  ctx: Ctx,
  lessonId: string,
  input: LessonAttachmentUploadInput,
  deps: LessonAttachmentDeps,
): Promise<Result<{ attachment: LessonAttachment; uploadUrl: string; expiresAt: string }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'course:write');
  if (!tenant.ok) return tenant;
  const parsed = lessonAttachmentUploadInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid attachment', parsed.error.flatten()));
  const lesson = await requireLesson(tenant.value, lessonId, deps.lessons);
  if (!lesson.ok) return lesson;
  const configuration = await resolveStorageConfiguration(tenant.value, deps.secretResolver);
  if (!configuration.ok) return configuration;

  const id = deps.ids.nextId();
  const storageKey = `lesson-attachments/${lessonId}/${id}/${storageFileName(parsed.data.fileName)}`;
  const signed = deps.storage.presignPut({
    url: deps.storage.objectUrl(configuration.value, storageKey).toString(),
    accessKeyId: configuration.value.accessKeyId,
    secretAccessKey: configuration.value.secretAccessKey,
    region: configuration.value.region,
    expiresInSeconds: ATTACHMENT_UPLOAD_TTL_SECONDS,
  });
  if (!signed.ok) return signed;
  const createdAt = deps.clock.nowIso();
  const attachment: LessonAttachment = {
    id,
    tenantId: tenant.value,
    lessonId,
    fileName: parsed.data.fileName,
    contentType: parsed.data.contentType,
    sizeBytes: parsed.data.sizeBytes,
    storageKey,
    status: 'pending',
    createdAt,
  };
  await deps.attachments.create(tenant.value, attachment);
  return ok({
    attachment,
    uploadUrl: signed.value,
    expiresAt: expiresAt(createdAt, ATTACHMENT_UPLOAD_TTL_SECONDS),
  });
};

export const completeLessonAttachmentUpload = async (
  ctx: Ctx,
  lessonId: string,
  attachmentId: string,
  deps: Pick<LessonAttachmentDeps, 'attachments' | 'secretResolver' | 'storage'>,
): Promise<Result<LessonAttachment, AppError>> => {
  const tenant = authorizeTenant(ctx, 'course:write');
  if (!tenant.ok) return tenant;
  const attachment = await deps.attachments.findById(tenant.value, attachmentId);
  if (attachment === null || attachment.lessonId !== lessonId) {
    return err(notFound(`No attachment "${attachmentId}" on this lesson`));
  }
  if (attachment.status === 'ready') return ok(attachment);
  const configuration = await resolveStorageConfiguration(tenant.value, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const storedObject = await deps.storage.head({
    url: deps.storage.objectUrl(configuration.value, attachment.storageKey).toString(),
    accessKeyId: configuration.value.accessKeyId,
    secretAccessKey: configuration.value.secretAccessKey,
    region: configuration.value.region,
  });
  if (!storedObject.ok) return storedObject;
  if (storedObject.value.sizeBytes < 1 || storedObject.value.sizeBytes > LESSON_ATTACHMENT_MAX_BYTES) {
    return err(validation(`Uploaded attachment must be between 1 and ${String(LESSON_ATTACHMENT_MAX_BYTES)} bytes`));
  }
  const ready = await deps.attachments.markReady(tenant.value, attachmentId, storedObject.value.sizeBytes);
  return ready === null
    ? err(notFound(`No attachment "${attachmentId}" on this lesson`))
    : ok(ready);
};

export const listLessonAttachments = async (
  ctx: Ctx,
  lessonId: string,
  deps: Pick<LessonAttachmentDeps, 'attachments' | 'lessons'>,
): Promise<Result<LessonAttachment[], AppError>> => {
  const tenant = authorizeTenant(ctx, 'course:read');
  if (!tenant.ok) return tenant;
  const lesson = await requireLesson(tenant.value, lessonId, deps.lessons);
  return lesson.ok
    ? ok(await deps.attachments.listByLesson(tenant.value, lessonId))
    : lesson;
};

export const listMemberLessonAttachments = async (
  ctx: Ctx,
  lessonId: string,
  deps: MemberLessonAttachmentDeps,
): Promise<Result<LessonAttachment[], AppError>> => {
  const tenant = authorizeTenant(ctx, 'lesson:play');
  if (!tenant.ok) return tenant;
  const lesson = await getAccessibleLesson(ctx, lessonId, deps);
  return lesson.ok
    ? ok(await deps.attachments.listReadyByLesson(tenant.value, lessonId))
    : lesson;
};

export const getLessonAttachmentDownload = async (
  ctx: Ctx,
  lessonId: string,
  attachmentId: string,
  deps: MemberLessonAttachmentDeps,
): Promise<Result<string, AppError>> => {
  const tenant = authorizeTenant(ctx, 'lesson:play');
  if (!tenant.ok) return tenant;
  const lesson = await getAccessibleLesson(ctx, lessonId, deps);
  if (!lesson.ok) return lesson;
  const attachment = await deps.attachments.findById(tenant.value, attachmentId);
  if (attachment === null || attachment.lessonId !== lessonId || attachment.status !== 'ready') {
    return err(notFound(`No attachment "${attachmentId}" on this lesson`));
  }
  const configuration = await resolveStorageConfiguration(tenant.value, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const target = deps.storage.objectUrl(configuration.value, attachment.storageKey);
  target.searchParams.set(
    'response-content-disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
  );
  target.searchParams.set('response-content-type', attachment.contentType);
  return deps.storage.presignGet({
    url: target.toString(),
    accessKeyId: configuration.value.accessKeyId,
    secretAccessKey: configuration.value.secretAccessKey,
    region: configuration.value.region,
    expiresInSeconds: ATTACHMENT_DOWNLOAD_TTL_SECONDS,
  });
};

export const deleteLessonAttachment = async (
  ctx: Ctx,
  lessonId: string,
  attachmentId: string,
  deps: Pick<LessonAttachmentDeps, 'attachments' | 'secretResolver' | 'storage'>,
): Promise<Result<{ deleted: true }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'course:write');
  if (!tenant.ok) return tenant;
  const attachment = await deps.attachments.findById(tenant.value, attachmentId);
  if (attachment === null || attachment.lessonId !== lessonId) {
    return err(notFound(`No attachment "${attachmentId}" on this lesson`));
  }
  const configuration = await resolveStorageConfiguration(tenant.value, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const deletedObject = await deps.storage.delete({
    url: deps.storage.objectUrl(configuration.value, attachment.storageKey).toString(),
    accessKeyId: configuration.value.accessKeyId,
    secretAccessKey: configuration.value.secretAccessKey,
    region: configuration.value.region,
  });
  const deleted = await deps.attachments.delete(tenant.value, attachmentId);
  if (!deleted) return err(notFound(`No attachment "${attachmentId}" on this lesson`));
  return deletedObject.ok
    ? ok({ deleted: true })
    : err({
        ...deletedObject.error,
        message: `Attachment detached, but storage object "${attachment.storageKey}" could not be deleted: ${deletedObject.error.message}`,
    });
};

export const deleteLessonAttachmentObjects = async (
  ctx: Ctx,
  lessonId: string,
  deps: Pick<LessonAttachmentDeps, 'attachments' | 'secretResolver' | 'storage'>,
): Promise<Result<{ deletedObjects: number }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'course:write');
  if (!tenant.ok) return tenant;
  const attachments = await deps.attachments.listByLesson(tenant.value, lessonId);
  if (attachments.length === 0) return ok({ deletedObjects: 0 });
  const configuration = await resolveStorageConfiguration(tenant.value, deps.secretResolver);
  if (!configuration.ok) return configuration;
  for (const attachment of attachments) {
    const deleted = await deps.storage.delete({
      url: deps.storage.objectUrl(configuration.value, attachment.storageKey).toString(),
      accessKeyId: configuration.value.accessKeyId,
      secretAccessKey: configuration.value.secretAccessKey,
      region: configuration.value.region,
    });
    if (!deleted.ok) return deleted;
  }
  return ok({ deletedObjects: attachments.length });
};
