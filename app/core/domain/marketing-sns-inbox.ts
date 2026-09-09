import { z } from 'zod';

export const marketingSnsInboxSchema = z.object({
  id: z.string().min(1), tenantId: z.string().min(1), topicArn: z.string().min(1), snsMessageId: z.string().min(1),
  messageType: z.enum(['Notification', 'SubscriptionConfirmation']), rawBody: z.string().nullable(), bodySha256: z.string().min(1),
  verifiedAt: z.string().datetime(), receivedAt: z.string().datetime(),
  status: z.enum(['pending', 'processing', 'retry', 'processed', 'ignored', 'dead_letter']),
  attempts: z.number().int().nonnegative(), nextAttemptAt: z.string().datetime(),
  lockedBy: z.string().nullable(), lockedUntil: z.string().datetime().nullable(), claimVersion: z.number().int().nonnegative(),
  processedAt: z.string().datetime().nullable(), lastError: z.string().nullable(), ignoreReason: z.string().nullable(),
});
export type MarketingSnsInbox = z.infer<typeof marketingSnsInboxSchema>;
export type SesEventApplication = { kind: 'applied' } | { kind: 'ignored'; reason: string } | { kind: 'awaiting_correlation' };

export type VerifiedSesEvent = {
  campaignSendId?: string | undefined;
  recipient?: string | undefined;
  topicArn: string;
  messageId: string;
  occurredAt: string;
  raw: unknown;
} & (
  | { kind: 'delivery' }
  | { kind: 'open' }
  | { kind: 'click'; linkUrl: string }
  | { kind: 'complaint' }
  | { kind: 'bounce'; bounceType: string; status: string | null }
);
export const storedSnsEnvelopeSchema = z.object({ Message: z.string(), SubscribeURL: z.string().optional() });
export const marketingSnsReceiptSchema = marketingSnsInboxSchema.omit({ rawBody: true });
const payloadSchema = z.object({
  notificationType: z.string().optional(), eventType: z.string().optional(),
  mail: z.object({ messageId: z.string().min(1), tags: z.record(z.array(z.string())).optional() }),
  delivery: z.object({ timestamp: z.string().datetime(), recipients: z.array(z.string().email()).optional() }).optional(),
  open: z.object({ timestamp: z.string().datetime() }).optional(),
  click: z.object({ timestamp: z.string().datetime(), link: z.string().min(1) }).optional(),
  bounce: z.object({ timestamp: z.string().datetime(), bounceType: z.string(), bouncedRecipients: z.array(z.object({ emailAddress: z.string().email().optional(), status: z.string().optional() })) }).optional(),
  complaint: z.object({ timestamp: z.string().datetime(), complainedRecipients: z.array(z.object({ emailAddress: z.string().email().optional() })).optional() }).optional(),
});
export const marketingSnsJsonValue = (raw: string): unknown => { try { return JSON.parse(raw); } catch { return null; } };

export const parseMarketingSesEvents = (raw: unknown, topicArn: string): VerifiedSesEvent[] => {
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return [];
  const value = parsed.data;
  const base = { topicArn, messageId: value.mail.messageId, raw, campaignSendId: value.mail.tags?.['together-send-id']?.[0] };
  const type = value.eventType ?? value.notificationType;
  if (type === 'Open' && value.open !== undefined) return [{ ...base, kind: 'open', occurredAt: value.open.timestamp }];
  if (type === 'Click' && value.click !== undefined) return [{ ...base, kind: 'click', occurredAt: value.click.timestamp, linkUrl: value.click.link }];
  if (type === 'Delivery' && value.delivery !== undefined) {
    const delivery = value.delivery;
    return (delivery.recipients?.length ? delivery.recipients : [undefined]).map((recipient) => ({ ...base, kind: 'delivery', occurredAt: delivery.timestamp, recipient }));
  }
  if (type === 'Complaint' && value.complaint !== undefined) {
    const complaint = value.complaint;
    return (complaint.complainedRecipients?.length ? complaint.complainedRecipients : [{}]).map((recipient) => ({ ...base, kind: 'complaint', occurredAt: complaint.timestamp, recipient: recipient.emailAddress }));
  }
  if (type === 'Bounce' && value.bounce !== undefined) {
    const bounce = value.bounce;
    return bounce.bouncedRecipients.map((recipient) => ({ ...base, kind: 'bounce', occurredAt: bounce.timestamp, bounceType: bounce.bounceType, status: recipient.status ?? null, recipient: recipient.emailAddress }));
  }
  return [];
};

