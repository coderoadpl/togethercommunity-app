import { z } from 'zod';

import { emailEventSchema } from './email-event.js';
import { scrubErasedEmailEvent } from './email-event-erasure.js';
import { classifySesEvent } from './marketing-email.js';
import { marketingSnsJsonValue, parseMarketingSesEvents, storedSnsEnvelopeSchema, type VerifiedSesEvent } from './marketing-sns-inbox.js';

const erasedEventSchema = z.object({
  kind: z.enum(['delivery', 'bounce', 'complaint', 'open', 'click']),
  messageId: z.string().min(1), campaignSendId: z.string().optional(), occurredAt: z.string().datetime(),
  raw: z.unknown(), linkUrl: z.string().optional(), classification: z.enum(['hard', 'soft', 'unresolved']).optional(),
});
const erasedEnvelopeSchema = z.object({ erasedSesEvents: z.array(erasedEventSchema).min(1) });

export const readStoredMarketingSesEvents = (rawBody: string | null, topicArn: string): VerifiedSesEvent[] => {
  const value = marketingSnsJsonValue(rawBody ?? '');
  const erased = erasedEnvelopeSchema.safeParse(value);
  if (erased.success) return erased.data.erasedSesEvents.map((event): VerifiedSesEvent => {
    const base = { messageId: event.messageId, campaignSendId: event.campaignSendId, occurredAt: event.occurredAt, raw: event.raw, topicArn };
    if (event.kind === 'bounce') return { ...base, kind: 'bounce',
      bounceType: event.classification === 'hard' ? 'Permanent' : event.classification === 'soft' ? 'Transient' : 'Undetermined',
      bounceSubType: null, status: null, diagnosticCode: null, action: null };
    if (event.kind === 'click') return { ...base, kind: 'click', linkUrl: event.linkUrl ?? '[erased]' };
    return { ...base, kind: event.kind };
  });
  const envelope = storedSnsEnvelopeSchema.safeParse(value);
  return envelope.success ? parseMarketingSesEvents(marketingSnsJsonValue(envelope.data.Message), topicArn) : [];
};

export const marketingSesRecipientAddresses = (event: VerifiedSesEvent): string[] => {
  const mail = z.object({ mail: z.object({ destination: z.array(z.string().email()).optional() }) }).safeParse(event.raw);
  return [...(event.recipient === undefined ? [] : [event.recipient]), ...(mail.success ? mail.data.mail.destination ?? [] : [])];
};

export const scrubErasedMarketingSnsBody = (rawBody: string | null, topicArn: string): string | null => {
  const events = readStoredMarketingSesEvents(rawBody, topicArn);
  if (events.length === 0) return rawBody;
  return JSON.stringify({ erasedSesEvents: events.map((event) => {
    const type = event.kind === 'click' ? 'clicked' : event.kind === 'open' ? 'opened'
      : event.kind === 'bounce' ? 'bounced' : event.kind === 'complaint' ? 'complained' : 'delivered';
    const classification = event.kind === 'bounce' ? classifySesEvent(event) : undefined;
    const scrubbed = scrubErasedEmailEvent(emailEventSchema.parse({ id: 'receipt', tenantId: 'receipt', mailKind: 'marketing', refId: 'receipt',
      type, occurredAt: event.occurredAt, createdAt: event.occurredAt,
      meta: { rawProviderPayload: event.raw, classification, ...(event.kind === 'click' ? { linkUrl: event.linkUrl } : {}) },
    }));
    return { kind: event.kind, messageId: event.messageId, campaignSendId: event.campaignSendId, occurredAt: event.occurredAt,
      raw: scrubbed.meta?.['rawProviderPayload'], classification, ...(event.kind === 'click' ? { linkUrl: scrubbed.meta?.linkUrl } : {}) };
  }) });
};
