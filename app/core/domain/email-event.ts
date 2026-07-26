import { z } from 'zod';

export const emailEventTypeSchema = z.enum([
  'queued',
  'claimed',
  'rendered',
  'accepted',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
  'skipped',
  'failed',
  'retried',
  'suppressed_written',
  'unsubscribed',
]);

export const emailEventMailKindSchema = z.enum(['transactional', 'marketing']);

const baseEmailEventSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  mailKind: emailEventMailKindSchema,
  refId: z.string().min(1),
  occurredAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export const emailEventSchema = z.discriminatedUnion('type', [
  baseEmailEventSchema.extend({ type: z.literal('queued'), meta: z.record(z.unknown()).nullable() }),
  baseEmailEventSchema.extend({ type: z.literal('claimed'), meta: z.record(z.unknown()).nullable() }),
  baseEmailEventSchema.extend({ type: z.literal('rendered'), meta: z.record(z.unknown()).nullable() }),
  baseEmailEventSchema.extend({
    type: z.literal('accepted'),
    meta: z.object({ sesMessageId: z.string().min(1) }).passthrough(),
  }),
  baseEmailEventSchema.extend({ type: z.literal('delivered'), meta: z.record(z.unknown()).nullable() }),
  baseEmailEventSchema.extend({ type: z.literal('opened'), meta: z.record(z.unknown()).nullable() }),
  baseEmailEventSchema.extend({
    type: z.literal('clicked'),
    meta: z.object({
      linkUrl: z.string().min(1),
      rawProviderPayload: z.unknown(),
    }).passthrough(),
  }),
  baseEmailEventSchema.extend({
    type: z.literal('bounced'),
    meta: z.object({
      classification: z.string().min(1),
      rawProviderPayload: z.unknown(),
    }).passthrough(),
  }),
  baseEmailEventSchema.extend({ type: z.literal('complained'), meta: z.record(z.unknown()).nullable() }),
  baseEmailEventSchema.extend({
    type: z.literal('skipped'),
    meta: z.object({ reason: z.string().min(1) }).passthrough(),
  }),
  baseEmailEventSchema.extend({
    type: z.literal('failed'),
    meta: z.object({ error: z.string().min(1) }).passthrough(),
  }),
  baseEmailEventSchema.extend({ type: z.literal('retried'), meta: z.record(z.unknown()).nullable() }),
  baseEmailEventSchema.extend({ type: z.literal('suppressed_written'), meta: z.record(z.unknown()).nullable() }),
  baseEmailEventSchema.extend({ type: z.literal('unsubscribed'), meta: z.record(z.unknown()).nullable() }),
]);

export type EmailEventType = z.output<typeof emailEventTypeSchema>;
export type EmailEventMailKind = z.output<typeof emailEventMailKindSchema>;
export type EmailEvent = z.output<typeof emailEventSchema>;
