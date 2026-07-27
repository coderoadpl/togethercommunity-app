import { z } from 'zod';

import { emailEventMailKindSchema } from './email-event.js';
import { ERROR_CODES } from './errors.js';
import { normalizeEmail } from './email.js';

export const emailSendStatusSchema = z.enum([
  'queued',
  'pending',
  'sending',
  'sent',
  'failed',
  'skipped',
]);

export const emailDeliveryStatusSchema = z.enum(['delivered', 'bounced', 'complained']);
export const transactionalEmailTransportSchema = z.enum(['tenant-ses', 'smtp', 'platform']);

export const emailSendCursorSchema = z.string().min(1).superRefine((value, ctx) => {
  const parts = value.split('~');
  try {
    if (
      parts.length !== 3
      || !emailEventMailKindSchema.safeParse(parts[1]).success
      || !z.string().datetime().safeParse(decodeURIComponent(parts[0] ?? '')).success
      || decodeURIComponent(parts[2] ?? '').length === 0
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid e-mail send cursor' });
    }
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid e-mail send cursor' });
  }
});

export const emailSendProjectionSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  kind: emailEventMailKindSchema,
  recipient: z.string().transform(normalizeEmail),
  subject: z.string().min(1),
  source: z.string().min(1),
  status: emailSendStatusSchema,
  skipReason: z.string().nullable(),
  failureCode: z.enum(ERROR_CODES).nullable(),
  failureMessage: z.string().nullable(),
  deliveryStatus: emailDeliveryStatusSchema.nullable(),
  deliveryOccurredAt: z.string().datetime().nullable(),
  campaignId: z.string().nullable(),
  campaignName: z.string().nullable(),
  sesMessageId: z.string().nullable(),
  transport: transactionalEmailTransportSchema,
  createdAt: z.string().datetime(),
  sentAt: z.string().datetime().nullable(),
});

export const emailSendListQuerySchema = z.object({
  kind: emailEventMailKindSchema.optional(),
  status: emailSendStatusSchema.optional(),
  deliveryStatus: emailDeliveryStatusSchema.optional(),
  transport: transactionalEmailTransportSchema.optional(),
  campaignId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  cursor: emailSendCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const emailSendExportQuerySchema = emailSendListQuerySchema
  .omit({ cursor: true, limit: true })
  .extend({ format: z.literal('csv') });

export const emailSendExportFileSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  content: z.string(),
});

export type EmailSendStatus = z.output<typeof emailSendStatusSchema>;
export type EmailDeliveryStatus = z.output<typeof emailDeliveryStatusSchema>;
export type TransactionalEmailTransport = z.output<typeof transactionalEmailTransportSchema>;
export type EmailSendProjection = z.output<typeof emailSendProjectionSchema>;
export type EmailSendListQuery = z.output<typeof emailSendListQuerySchema>;
export type EmailSendListQueryInput = z.input<typeof emailSendListQuerySchema>;
export type EmailSendExportQueryInput = z.input<typeof emailSendExportQuerySchema>;
export type EmailSendExportFile = z.output<typeof emailSendExportFileSchema>;
