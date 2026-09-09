import { z } from 'zod';

import { marketingReplyToSchema } from './marketing-email.js';

const marketingOutboxPayloadSchema = z.object({
  campaignSendId: z.string().min(1),
  consentDefinitionId: z.string().min(1),
  to: z.string().email(),
  subject: z.string().min(1),
  html: z.string().min(1).max(1_000_000),
  text: z.string().min(1).max(1_000_000),
  headers: z.record(z.string()),
  from: z.object({ address: z.string().email(), name: z.string().min(1) }),
  replyTo: marketingReplyToSchema,
  configurationSet: z.string().nullable(),
});
export type MarketingOutboxPayload = z.infer<typeof marketingOutboxPayloadSchema>;

export const marketingOutboxSchema = z.object({
  id: z.string().min(1), tenantId: z.string().min(1), campaignSendId: z.string().min(1),
  payload: marketingOutboxPayloadSchema.nullable(), payloadPurgedAt: z.string().datetime().nullable(),
  status: z.enum(['pending', 'dispatching', 'retry', 'sent', 'skipped', 'failed', 'uncertain']),
  attempts: z.number().int().nonnegative(), nextAttemptAt: z.string().datetime(),
  lockedBy: z.string().nullable(), lockedUntil: z.string().datetime().nullable(), claimVersion: z.number().int().nonnegative(),
  sesMessageId: z.string().nullable(), lastError: z.string().nullable(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type MarketingOutbox = z.infer<typeof marketingOutboxSchema>;
