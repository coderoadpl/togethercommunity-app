import { z } from 'zod';

import { emailEventSchema } from './email-event.js';
import { scrubErasedEmailEvent } from './email-event-erasure.js';
import { classifySesEvent } from './marketing-email.js';
import { marketingSnsJsonValue, parseMarketingSesEvents, storedSnsEnvelopeSchema, type VerifiedSesEvent } from './marketing-sns-inbox.js';

const erasedEventSchema = z.object({
  kind: z.enum(['delivery', 'bounce', 'complaint', 'open', 'click']),
  messageId: z.string().min(1), campaignSendId: z.string().optional(), occurredAt: z.string().datetime(),
  recipientHmac: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  raw: z.unknown(), linkUrl: z.string().optional(), classification: z.enum(['hard', 'soft', 'unresolved']).optional(),
});
const correlationSchema = z.object({ messageId: z.string().min(1), campaignSendId: z.string().optional(), recipients: z.array(z.string()) });
export type MarketingSesCorrelation = z.infer<typeof correlationSchema>;
const scrubbedBodyPrefix = 'together-scrubbed:v1:';
const erasedEnvelopeSchema = z.object({ serverScrubbed: z.literal(true), Message: z.string(),
  correlations: z.array(correlationSchema), erasedSesEvents: z.array(erasedEventSchema) });
// Verified caller bodies are JSON envelopes and cannot carry this non-JSON prefix.
const readErasedEnvelope = (rawBody: string | null) => erasedEnvelopeSchema.safeParse(
  rawBody?.startsWith(scrubbedBodyPrefix) ? marketingSnsJsonValue(rawBody.slice(scrubbedBodyPrefix.length)) : undefined,
);
const mailSchema = z.object({ mail: z.object({ messageId: z.string().min(1),
  tags: z.record(z.array(z.string())).optional(), destination: z.array(z.string()).optional() }) });
const scrubbedMessageSchema = z.object({ eventType: z.string().optional(), notificationType: z.string().optional(),
  mail: z.object({ messageId: z.string(), timestamp: z.string().datetime().optional() }) });

export const readStoredMarketingSesEvents = (rawBody: string | null, topicArn: string): VerifiedSesEvent[] => {
  const value = marketingSnsJsonValue(rawBody ?? '');
  const erased = readErasedEnvelope(rawBody);
  if (erased.success) return erased.data.erasedSesEvents.map((event): VerifiedSesEvent => {
    const base = { messageId: event.messageId, campaignSendId: event.campaignSendId, occurredAt: event.occurredAt, recipientHmac: event.recipientHmac, raw: event.raw, topicArn };
    if (event.kind === 'bounce') return { ...base, kind: 'bounce',
      bounceType: event.classification === 'hard' ? 'Permanent' : event.classification === 'soft' ? 'Transient' : 'Undetermined',
      bounceSubType: null, status: null, diagnosticCode: null, action: null };
    if (event.kind === 'click') return { ...base, kind: 'click', linkUrl: event.linkUrl ?? '[erased]' };
    return { ...base, kind: event.kind };
  });
  const envelope = storedSnsEnvelopeSchema.safeParse(value);
  return envelope.success ? parseMarketingSesEvents(marketingSnsJsonValue(envelope.data.Message), topicArn) : [];
};

export const readStoredMarketingSesCorrelations = (rawBody: string | null, topicArn: string): MarketingSesCorrelation[] => {
  const value = marketingSnsJsonValue(rawBody ?? '');
  const erased = readErasedEnvelope(rawBody);
  if (erased.success) return erased.data.correlations;
  const envelope = storedSnsEnvelopeSchema.safeParse(value);
  if (!envelope.success) return [];
  const raw = marketingSnsJsonValue(envelope.data.Message);
  const payload = mailSchema.safeParse(raw);
  if (!payload.success) return [];
  return [{ messageId: payload.data.mail.messageId, campaignSendId: payload.data.mail.tags?.['together-send-id']?.[0],
    recipients: [...(payload.data.mail.destination ?? []), ...parseMarketingSesEvents(raw, topicArn)
      .flatMap((event) => event.recipient === undefined ? [] : [event.recipient])] }];
};

export const scrubErasedMarketingSnsBody = (rawBody: string | null, topicArn: string, hashRecipient: (email: string) => string): string | null => {
  const value = marketingSnsJsonValue(rawBody ?? '');
  if (readErasedEnvelope(rawBody).success) return rawBody;
  const envelope = storedSnsEnvelopeSchema.safeParse(value);
  if (!envelope.success) return rawBody;
  const message = scrubbedMessageSchema.safeParse(marketingSnsJsonValue(envelope.data.Message));
  const correlations = readStoredMarketingSesCorrelations(rawBody, topicArn);
  if (correlations.length === 0) return rawBody;
  const events = readStoredMarketingSesEvents(rawBody, topicArn);
  return scrubbedBodyPrefix + JSON.stringify({ serverScrubbed: true, Message: JSON.stringify(message.success ? message.data : {}),
    correlations: correlations.map((correlation) => ({ ...correlation, recipients: [] })), erasedSesEvents: events.map((event) => {
    const type = event.kind === 'click' ? 'clicked' : event.kind === 'open' ? 'opened'
      : event.kind === 'bounce' ? 'bounced' : event.kind === 'complaint' ? 'complained' : 'delivered';
    const classification = event.kind === 'bounce' ? classifySesEvent(event) : undefined;
    const scrubbed = scrubErasedEmailEvent(emailEventSchema.parse({ id: 'receipt', tenantId: 'receipt', mailKind: 'marketing', refId: 'receipt',
      type, occurredAt: event.occurredAt, createdAt: event.occurredAt,
      meta: { rawProviderPayload: event.raw, classification, ...(event.kind === 'click' ? { linkUrl: event.linkUrl } : {}) },
    }));
    const recipientHmac = event.recipient === undefined ? event.recipientHmac : hashRecipient(event.recipient);
    return { kind: event.kind, recipientHmac, messageId: event.messageId, campaignSendId: event.campaignSendId, occurredAt: event.occurredAt,
      raw: scrubbed.meta?.['rawProviderPayload'], classification, ...(event.kind === 'click' ? { linkUrl: scrubbed.meta?.linkUrl } : {}) };
  }) });
};
