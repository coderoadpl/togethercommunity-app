import { z } from 'zod';

export const LESSON_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

const lessonAttachmentStatusSchema = z.enum(['pending', 'ready']);

export const lessonAttachmentSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  lessonId: z.string().min(1),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().max(LESSON_ATTACHMENT_MAX_BYTES),
  storageKey: z.string().min(1),
  status: lessonAttachmentStatusSchema,
  createdAt: z.string().datetime(),
});

export type LessonAttachment = z.infer<typeof lessonAttachmentSchema>;

export const lessonAttachmentMetadataSchema = lessonAttachmentSchema.omit({
  tenantId: true,
  storageKey: true,
  status: true,
});

export type LessonAttachmentMetadata = z.infer<typeof lessonAttachmentMetadataSchema>;

export const lessonAttachmentViewSchema = lessonAttachmentMetadataSchema.extend({
  downloadPath: z.string().startsWith('/'),
});

export type LessonAttachmentView = z.infer<typeof lessonAttachmentViewSchema>;

export const lessonAttachmentUploadInputSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().max(LESSON_ATTACHMENT_MAX_BYTES),
});

export type LessonAttachmentUploadInput = z.input<typeof lessonAttachmentUploadInputSchema>;
