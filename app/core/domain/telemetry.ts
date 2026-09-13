import { z } from 'zod';

import type { EmailEvent, EmailEventType } from './email-event.js';
import type { MemberEvent, MemberEventType } from './member-event.js';

const identifier = z.string().min(1).max(256);
const timestamp = z.string().datetime();
export const telemetryEventSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(1024).startsWith('v1:'),
  tenantId: identifier,
  campaignId: identifier.nullable(),
  contactId: identifier.nullable(),
  memberId: identifier.nullable(),
  sendId: identifier.nullable(),
  sesMessageId: identifier.nullable(),
  occurredAt: timestamp,
  ingestedAt: timestamp,
  type: z.enum(['delivered', 'bounced', 'complained', 'opened', 'clicked', 'unsubscribed', 'suppressed', 'member-activity', 'purchase']),
  bounceClassification: z.enum(['hard', 'soft', 'unresolved']).nullable(),
  complaintType: z.enum(['abuse', 'auth-failure', 'fraud', 'not-spam', 'other', 'virus', 'unknown']).nullable(),
  linkId: identifier.nullable(),
  destination: z.string().url().max(2048).regex(/^https?:\/\//iu).nullable(),
  trackingPolicyVersion: identifier,
  activityType: z.enum(['sign-in', 'lesson-completion', 'grant', 'revoke', 'subscription-adopted', 'subscription-change']).nullable(),
  orderId: identifier.nullable(),
});
export type TelemetryEvent = z.output<typeof telemetryEventSchema>;

const emailTypes: Record<EmailEventType, TelemetryEvent['type'] | null> = {
  queued: null, claimed: null, rendered: null, accepted: null,
  delivered: 'delivered', opened: 'opened', clicked: 'clicked', bounced: 'bounced',
  complained: 'complained', skipped: null, failed: null, retried: null, uncertain: null,
  suppressed_written: 'suppressed', unsubscribed: 'unsubscribed',
};
const memberTypes: Record<MemberEventType, TelemetryEvent['type'] | null> = {
  'sign-in': 'member-activity', banned: null, unbanned: null, purchase: 'purchase',
  grant: 'member-activity', revoke: 'member-activity', 'subscription-adopted': 'member-activity',
  'subscription-change': 'member-activity', 'lesson-completion': 'member-activity', 'email-sent': null,
};
const nullableField = <T>(schema: z.ZodType<T>, value: unknown): T | null => {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
};
const base = {
  version: 1 as const, campaignId: null, contactId: null, memberId: null, sendId: null,
  sesMessageId: null, bounceClassification: null, complaintType: null, linkId: null,
  destination: null, activityType: null, orderId: null,
};
export const normalizeEmailTelemetry = (
  event: EmailEvent,
  correlation: Pick<TelemetryEvent, 'campaignId' | 'contactId' | 'memberId' | 'sesMessageId' | 'trackingPolicyVersion'>,
): TelemetryEvent | null => {
  const type = emailTypes[event.type];
  if (type === null || event.mailKind !== 'marketing') return null;
  return telemetryEventSchema.parse({
    ...base, ...correlation, version: 1, id: `v1:email:${event.id}`, tenantId: event.tenantId,
    sendId: event.refId, occurredAt: event.occurredAt, ingestedAt: event.createdAt, type,
    bounceClassification: nullableField(telemetryEventSchema.shape.bounceClassification, event.meta?.['classification']),
    complaintType: nullableField(telemetryEventSchema.shape.complaintType, event.meta?.['complaintType']),
    linkId: nullableField(identifier, event.meta?.['linkId']),
    destination: nullableField(telemetryEventSchema.shape.destination, event.meta?.['linkUrl']),
  });
};
export const normalizeMemberTelemetry = (
  event: MemberEvent,
  input: Pick<TelemetryEvent, 'contactId' | 'ingestedAt' | 'trackingPolicyVersion'>,
): TelemetryEvent | null => {
  const type = memberTypes[event.type];
  if (type === null) return null;
  return telemetryEventSchema.parse({
    ...base, ...input, id: `v1:member:${event.id}`, tenantId: event.tenantId,
    memberId: event.memberId, occurredAt: event.occurredAt, type,
    activityType: type === 'member-activity' ? event.type : null,
    orderId: event.type === 'purchase' ? event.payload.orderId : null,
  });
};

const telemetryEgressSchema = z.object({
  mode: z.enum(['stable', 'dynamic', 'unknown']),
  ip: z.string().ip().nullable(),
});
export const telemetryStoreSettingsSchema = z.object({
  provider: z.literal('mongodb').nullable(),
  region: z.string().trim().max(100),
  connectedAt: timestamp.nullable(),
  lastProbeAt: timestamp.nullable(),
  lastProbeResult: z.enum(['ok', 'error']).nullable(),
  egressMode: telemetryEgressSchema.shape.mode,
});
export type TelemetryStoreSettings = z.output<typeof telemetryStoreSettingsSchema>;
export const telemetryConnectionSchema = z.object({
  connectionString: z.string().trim().min(1).max(4096).regex(/^mongodb(?:\+srv)?:\/\//u),
  region: z.string().trim().min(1).max(100),
});
export const telemetrySyncSchema = z.object({
  lastAcknowledgedSequence: z.number().int().nonnegative(),
  lastAcknowledgedAt: timestamp.nullable(),
  pendingBytes: z.number().int().nonnegative(),
  oldestPendingAt: timestamp.nullable(),
  oldestPendingAgeSeconds: z.number().int().nonnegative().nullable().optional(),
  gapCount: z.number().int().nonnegative(),
  admissionPaused: z.boolean(),
});
export const telemetryStoreViewSchema = z.object({
  settings: telemetryStoreSettingsSchema,
  egress: telemetryEgressSchema,
  sync: telemetrySyncSchema,
  hidesStatistics: z.boolean(),
});
export type TelemetryStoreView = z.output<typeof telemetryStoreViewSchema>;
export const telemetryCampaignStatsSchema = z.object({
  campaignId: identifier,
  totalOpens: z.number().int().nonnegative(), uniqueOpens: z.number().int().nonnegative(),
  totalClicks: z.number().int().nonnegative(), uniqueClicks: z.number().int().nonnegative(),
});
export const telemetryPageSchema = z.object({
  events: z.array(telemetryEventSchema), nextCursor: z.string().nullable(),
});
export const TELEMETRY_LIMITS = {
  tenantBytes: 64 * 1024 * 1024, globalBytes: 1024 * 1024 * 1024,
  tenantAdmissionBytes: 48 * 1024 * 1024, globalAdmissionBytes: 768 * 1024 * 1024,
  gapLedgerBytes: 64 * 1024, oldestPendingMs: 24 * 60 * 60 * 1000,
} as const;
