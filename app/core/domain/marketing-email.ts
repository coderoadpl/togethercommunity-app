import { z } from 'zod';

import { normalizeEmail } from './email.js';
import { validation, type AppError } from './errors.js';
import { err, ok, type Result } from './result.js';

export const isoDateTimeSchema = z.string().datetime();

export const transactionalSesConfigurationSetName = (
  marketingConfigurationSet: string,
): string => `${marketingConfigurationSet.slice(0, 50)}-transactional`;

export const consentDocumentRefSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('url'), url: z.string().url() }),
  z.object({ mode: z.literal('hosted'), documentId: z.string().min(1) }),
]);

export type ConsentDocumentRef = z.infer<typeof consentDocumentRefSchema>;

const consentDocumentVersionRefSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('url'), url: z.string().url() }),
  z.object({ mode: z.literal('hosted'), documentVersionId: z.string().min(1) }),
]);

export type ConsentDocumentVersionRef = z.infer<typeof consentDocumentVersionRefSchema>;

export const consentDefinitionSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  kind: z.enum(['required_terms', 'optional_marketing']),
  channel: z.literal('email'),
  doubleOptIn: z.boolean(),
  documentRef: consentDocumentRefSchema,
  status: z.enum(['active', 'archived']),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type ConsentDefinition = z.infer<typeof consentDefinitionSchema>;

export const consentDefinitionVersionSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  definitionId: z.string().min(1),
  version: z.number().int().positive(),
  label: z.string().trim().min(1),
  documentVersionRef: consentDocumentVersionRefSchema,
  createdAt: isoDateTimeSchema,
  createdBy: z.string().nullable(),
});

export type ConsentDefinitionVersion = z.infer<typeof consentDefinitionVersionSchema>;

export const tenantDocumentSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1),
  status: z.enum(['draft', 'published', 'archived']),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type TenantDocument = z.infer<typeof tenantDocumentSchema>;

export const tenantDocumentVersionSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  documentId: z.string().min(1),
  version: z.number().int().positive(),
  content: z.string().min(1),
  publishedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  createdBy: z.string().nullable(),
});

export type TenantDocumentVersion = z.infer<typeof tenantDocumentVersionSchema>;

const marketingConsentStatusSchema = z.enum(['granted', 'confirmed', 'withdrawn']);
export const marketingConsentSourceSchema = z.enum([
  'checkout',
  'panel',
  'import',
  'api',
  'preference_page',
]);

const consentEvidenceSchema = z.object({
  collectedAt: isoDateTimeSchema,
  ip: z.string().min(1).optional(),
  userAgent: z.string().min(1).optional(),
  proofRef: z.string().min(1).optional(),
}).passthrough();

export type ConsentEvidence = z.infer<typeof consentEvidenceSchema>;

export const marketingConsentSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  memberId: z.string().nullable(),
  email: z.string().email().transform(normalizeEmail),
  definitionId: z.string().min(1),
  definitionVersion: z.number().int().positive(),
  wordingSnapshot: z.string().min(1),
  documentRefSnapshot: consentDocumentVersionRefSchema,
  status: marketingConsentStatusSchema,
  previousId: z.string().nullable(),
  source: marketingConsentSourceSchema,
  evidence: consentEvidenceSchema,
  occurredAt: isoDateTimeSchema,
});

export type MarketingConsent = z.output<typeof marketingConsentSchema>;

export const marketingConsentCreatorSchema = z.object({
  kind: z.literal('optional_marketing'),
  channel: z.literal('email'),
  required: z.literal(false),
  preTicked: z.literal(false),
});

type ConsentState = 'none' | 'pending_confirmation' | 'active' | 'withdrawn';

export interface DerivedConsentState {
  state: ConsentState;
  active: boolean;
  row: MarketingConsent | null;
}

export const deriveConsentState = (
  rows: MarketingConsent[],
  definition: Pick<ConsentDefinition, 'id' | 'doubleOptIn'>,
): DerivedConsentState => {
  const row = rows
    .filter((candidate) => candidate.definitionId === definition.id)
    .reduce<MarketingConsent | null>(
      (latest, candidate) => latest === null || candidate.occurredAt >= latest.occurredAt ? candidate : latest,
      null,
    );
  if (row === null) return { state: 'none', active: false, row: null };
  if (row.status === 'withdrawn') return { state: 'withdrawn', active: false, row };
  if (row.status === 'confirmed' || !definition.doubleOptIn) return { state: 'active', active: true, row };
  return { state: 'pending_confirmation', active: false, row };
};

export const requiresConsentVersionBump = (
  current: Pick<ConsentDefinitionVersion, 'label' | 'documentVersionRef'>,
  next: Pick<ConsentDefinitionVersion, 'label' | 'documentVersionRef'>,
): boolean => current.label !== next.label
  || JSON.stringify(current.documentVersionRef) !== JSON.stringify(next.documentVersionRef);

const suppressionReasonSchema = z.enum([
  'hard_bounce',
  'complaint',
  'manual',
  'unsubscribe_global',
  'erasure',
]);

export const suppressionSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  email: z.string().email().transform(normalizeEmail).nullable(),
  emailHmac: z.string().min(1),
  reason: suppressionReasonSchema,
  sourceRef: z.string().nullable(),
  meta: z.unknown().nullable().default(null),
  createdAt: isoDateTimeSchema,
  liftedAt: isoDateTimeSchema.nullable(),
  liftedBy: z.string().nullable(),
});

export type Suppression = z.output<typeof suppressionSchema>;

export type MarketingIneligibilityReason =
  | 'not_consented'
  | 'suppressed'
  | 'unsubscribed'
  | 'pending_confirmation';

export const deriveMarketingEligibility = (input: {
  consent: DerivedConsentState;
  suppressed: boolean;
}): { eligible: true; consentRow: MarketingConsent } | { eligible: false; reason: MarketingIneligibilityReason } => {
  if (input.suppressed) return { eligible: false, reason: 'suppressed' };
  if (input.consent.state === 'withdrawn') return { eligible: false, reason: 'unsubscribed' };
  if (input.consent.state === 'pending_confirmation') return { eligible: false, reason: 'pending_confirmation' };
  if (!input.consent.active || input.consent.row === null) return { eligible: false, reason: 'not_consented' };
  return { eligible: true, consentRow: input.consent.row };
};

export const suppressionMatchesEmail = (
  suppression: Pick<Suppression, 'emailHmac' | 'liftedAt'>,
  email: string,
  hmac: (normalizedEmail: string) => string,
): boolean => suppression.liftedAt === null && suppression.emailHmac === hmac(normalizeEmail(email));

export const liftSuppression = (
  suppression: Suppression,
  input: { actorId: string; liftedAt: string },
): Result<Suppression, AppError> => {
  if (suppression.reason === 'complaint') return err(validation('Complaint suppressions are permanent'));
  if (input.actorId.trim() === '' || !isoDateTimeSchema.safeParse(input.liftedAt).success) {
    return err(validation('Lifting a suppression requires an actor and timestamp'));
  }
  return ok({ ...suppression, liftedBy: input.actorId, liftedAt: input.liftedAt });
};

const unsubscribeScopeSchema = z.union([
  z.literal('all_marketing'),
  z.string().regex(/^consent:.+$/),
]);

export const unsubscribeTokenSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  token: z.string().regex(/^[A-Za-z0-9_-]{22,}$/),
  email: z.string().email().transform(normalizeEmail),
  memberId: z.string().nullable(),
  campaignSendId: z.string().nullable(),
  scope: unsubscribeScopeSchema,
  createdAt: isoDateTimeSchema,
  usedAt: isoDateTimeSchema.nullable(),
});

export type UnsubscribeToken = z.output<typeof unsubscribeTokenSchema>;

export const consentConfirmationTokenSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  token: z.string().regex(/^[A-Za-z0-9_-]{22,}$/),
  marketingConsentRowId: z.string().min(1),
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  usedAt: isoDateTimeSchema.nullable(),
});

export type ConsentConfirmationToken = z.output<typeof consentConfirmationTokenSchema>;

export type ResolvedUnsubscribeScope =
  | { kind: 'all_marketing' }
  | { kind: 'consent'; definitionId: string };

const resolveUnsubscribeScope = (scope: UnsubscribeToken['scope']): ResolvedUnsubscribeScope =>
  scope === 'all_marketing'
    ? { kind: 'all_marketing' }
    : { kind: 'consent', definitionId: scope.slice('consent:'.length) };

export const consumeUnsubscribeToken = (
  token: UnsubscribeToken,
  usedAt: string,
): Result<{ token: UnsubscribeToken; scope: ResolvedUnsubscribeScope; newlyUsed: boolean }, AppError> => {
  const parsed = unsubscribeTokenSchema.safeParse(token);
  if (!parsed.success || !isoDateTimeSchema.safeParse(usedAt).success) {
    return err(validation('Invalid unsubscribe token'));
  }
  const newlyUsed = parsed.data.usedAt === null;
  const consumed = newlyUsed ? { ...parsed.data, usedAt } : parsed.data;
  return ok({ token: consumed, scope: resolveUnsubscribeScope(consumed.scope), newlyUsed });
};

export const confirmationTokenIsValid = (
  token: Pick<ConsentConfirmationToken, 'expiresAt' | 'usedAt'>,
  now: string,
): boolean => token.usedAt === null && now < token.expiresAt;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const lookupPath = (data: Record<string, unknown>, path: string): unknown => {
  let current: unknown = data;
  for (const part of path.split('.')) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = current[part];
  }
  return current;
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character] ?? character);

const stringifyTemplateValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(stringifyTemplateValue).join(', ');
  if (typeof value === 'object') return '';
  return String(value);
};

const templatePath = '[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*)*';
const templateSlot = new RegExp(`\\{\\{\\{\\s*(${templatePath})(?:\\s*\\?\\?\\s*([^{}]*?))?\\s*\\}\\}\\}|\\{\\{\\s*(${templatePath})(?:\\s*\\?\\?\\s*([^{}]*?))?\\s*\\}\\}`, 'g');

const fallbackValue = (fallback: string | undefined): string => {
  if (fallback === undefined) return '';
  const trimmed = fallback.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

export const renderMarketingTemplate = (
  template: string,
  data: Record<string, unknown>,
): Result<string, AppError> => {
  let invalid = false;
  const rendered = template.replace(templateSlot, (match, rawPath, rawFallback, escapedPath, escapedFallback) => {
    const path = typeof rawPath === 'string' ? rawPath : escapedPath;
    if (typeof path !== 'string') {
      invalid = true;
      return '';
    }
    const value = lookupPath(data, path);
    const fallback = typeof rawPath === 'string' ? rawFallback : escapedFallback;
    const output = stringifyTemplateValue(value ?? fallbackValue(typeof fallback === 'string' ? fallback : undefined));
    return typeof rawPath === 'string' ? output : escapeHtml(output);
  });
  if (invalid || rendered.includes('{{') || rendered.includes('}}')) {
    return err(validation('Template contains an unsupported expression'));
  }
  return ok(rendered);
};

export const validateRenderedMarketingOutput = (
  body: string,
  required: { unsubscribeUrl: string; legalName: string; address: string; consentReference: string },
): Result<void, AppError> => {
  const missing = Object.entries(required)
    .filter(([, value]) => value.trim() === '' || !body.includes(value))
    .map(([field]) => field);
  return missing.length === 0
    ? ok(undefined)
    : err(validation('Rendered marketing output is missing mandatory footer content', { missing }));
};

export type EmailHeaders = Record<string, string>;

const canonicalMarketingHeaders = (unsubscribeUrl: string): EmailHeaders => ({
  'List-Unsubscribe': `<${unsubscribeUrl}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  Precedence: 'bulk',
  'Auto-Submitted': 'auto-generated',
  'X-Auto-Response-Suppress': 'All',
});

const hasHeaderBreak = (value: string): boolean => value.includes('\r') || value.includes('\n');

export const buildEmailHeaders = (input: {
  kind: 'marketing' | 'transactional';
  unsubscribeUrl?: string;
  callerHeaders?: EmailHeaders;
}): Result<EmailHeaders, AppError> => {
  const callerHeaders = input.callerHeaders ?? {};
  if (Object.entries(callerHeaders).some(([name, value]) => hasHeaderBreak(name) || hasHeaderBreak(value))) {
    return err(validation('Email headers cannot contain line breaks'));
  }
  if (input.kind === 'transactional') {
    return ok(Object.fromEntries(Object.entries(callerHeaders).filter(([name]) => {
      const lower = name.toLowerCase();
      return lower !== 'list-unsubscribe' && lower !== 'list-unsubscribe-post';
    })));
  }
  if (input.unsubscribeUrl === undefined || !z.string().url().safeParse(input.unsubscribeUrl).success) {
    return err(validation('Marketing email requires an unsubscribe URL'));
  }
  const headers = canonicalMarketingHeaders(input.unsubscribeUrl);
  for (const [name, value] of Object.entries(callerHeaders)) {
    const existing = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    if (existing !== undefined) headers[existing] = value;
    else headers[name] = value;
  }
  return ok(headers);
};

const campaignStatusSchema = z.enum([
  'draft',
  'scheduled',
  'running',
  'paused',
  'cancelled',
  'finished',
]);

export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

export const campaignSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().min(1),
  subject: z.string().min(1),
  bodyHtml: z.string().min(1),
  bodySource: z.string().min(1),
  layoutId: z.string().nullable(),
  consentDefinitionId: z.string().min(1),
  audienceFilter: z.object({ productIds: z.array(z.string()).optional() }).nullable(),
  status: campaignStatusSchema,
  sendAt: isoDateTimeSchema.nullable(),
  snapshotMaxMemberId: z.string().nullable(),
  cursorMemberId: z.string().nullable(),
  toSend: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  lockedUntil: isoDateTimeSchema.nullable(),
  lockedBy: z.string().nullable(),
  errorCount: z.number().int().nonnegative(),
  pausedReason: z.string().nullable(),
  audienceNameSnapshot: z.string().nullable(),
  consentLabelSnapshot: z.string().nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

export type Campaign = z.infer<typeof campaignSchema>;

const campaignTransitions: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['scheduled', 'cancelled'],
  scheduled: ['draft', 'running', 'cancelled'],
  running: ['paused', 'cancelled', 'finished'],
  paused: ['running', 'cancelled'],
  cancelled: [],
  finished: [],
};

export const campaignCanTransition = (from: CampaignStatus, to: CampaignStatus): boolean =>
  campaignTransitions[from].includes(to);

export const campaignCanEditContent = (status: CampaignStatus): boolean =>
  status === 'draft' || status === 'scheduled';

const rawContentSlot = /\{\{\{\s*content\s*\}\}\}/g;

export const emailLayoutSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().trim().min(1),
  bodyHtml: z.string().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).superRefine((layout, ctx) => {
  if ((layout.bodyHtml.match(rawContentSlot) ?? []).length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bodyHtml'],
      message: 'Marketing layouts require exactly one raw content slot',
    });
  }
});

export type EmailLayout = z.output<typeof emailLayoutSchema>;

export const campaignSendSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1).nullable().optional(),
  tenantId: z.string().min(1),
  campaignId: z.string().nullable(),
  source: z.enum(['broadcast', 'api']),
  memberId: z.string().nullable(),
  email: z.string().email().transform(normalizeEmail),
  subject: z.string().min(1),
  consentRowId: z.string().min(1).nullable(),
  unsubscribeTokenId: z.string().nullable(),
  status: z.enum(['pending', 'sending', 'sent', 'failed', 'skipped']),
  skipReason: z.enum(['suppressed', 'unsubscribed', 'not_consented', 'pending_confirmation']).nullable(),
  sesMessageId: z.string().nullable(),
  deliveryStatus: z.enum(['delivered', 'bounced', 'complained']).nullable(),
  deliveryOccurredAt: isoDateTimeSchema.nullable(),
  idempotencySource: z.string().nullable(),
  renderedBodyPurgedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  sentAt: isoDateTimeSchema.nullable(),
});

export type CampaignSend = z.output<typeof campaignSendSchema>;

export const campaignEngagementStatsSchema = z.object({
  uniqueOpens: z.number().int().nonnegative(),
  totalOpens: z.number().int().nonnegative(),
  uniqueClicks: z.number().int().nonnegative(),
  totalClicks: z.number().int().nonnegative(),
});

export type CampaignEngagementStats = z.output<typeof campaignEngagementStatsSchema>;

export type BounceClassification = 'soft' | 'hard' | 'complaint';

export const classifySesEvent = (event:
  | { kind: 'complaint' }
  | { kind: 'bounce'; bounceType: string; status: string | null }
): BounceClassification => {
  if (event.kind === 'complaint') return 'complaint';
  if (event.status === '5.4.4') return 'hard';
  return event.bounceType === 'Transient' ? 'soft' : 'hard';
};

export const bounceAction = (classification: BounceClassification): {
  threshold: number;
  suppress: boolean;
  permanent: boolean;
} => {
  if (classification === 'soft') return { threshold: 2, suppress: false, permanent: false };
  if (classification === 'hard') return { threshold: 1, suppress: true, permanent: false };
  return { threshold: 1, suppress: true, permanent: true };
};

export const tenantSesSettingsSchema = z.object({
  tenantId: z.string().min(1),
  fromAddress: z.string().email().transform(normalizeEmail),
  fromName: z.string().min(1),
  identity: z.string().min(1),
  identityVerifiedAt: isoDateTimeSchema.nullable(),
  identityCheckedAt: isoDateTimeSchema.nullable(),
  identityCheckError: z.string().nullable(),
  configurationSet: z.string().nullable(),
  snsTopicArn: z.string().nullable(),
  trackingEnabled: z.boolean(),
  autoPauseOnCritical: z.boolean(),
  webhookToken: z.string().min(22),
  quotaRatePerSec: z.number().nonnegative(),
  quotaDaily: z.number().int().nonnegative(),
  quotaSentLast24Hours: z.number().int().nonnegative(),
  quotaRefreshedAt: isoDateTimeSchema.nullable(),
  inSandbox: z.boolean(),
  webhookVerifiedAt: isoDateTimeSchema.nullable(),
  footerLegalName: z.string(),
  footerAddress: z.string(),
  broadcastsEnabled: z.boolean(),
  reputationAlertStatus: z
    .enum(['insufficient_data', 'ok', 'warn', 'critical'])
    .nullable(),
  reputationAlertedAt: isoDateTimeSchema.nullable(),
});

export type TenantSesSettings = z.output<typeof tenantSesSettingsSchema>;

export const tenantSesBroadcastsReady = (settings: TenantSesSettings): boolean =>
  settings.identityVerifiedAt !== null
  && settings.configurationSet !== null
  && settings.webhookVerifiedAt !== null
  && settings.quotaRefreshedAt !== null
  && settings.footerLegalName.trim() !== ''
  && settings.footerAddress.trim() !== ''
  && !settings.inSandbox;

export const sesIdentityFreshness = (
  settings: TenantSesSettings,
  now: string,
  staleAfterMs = 24 * 60 * 60 * 1000,
): 'never-checked' | 'stale' | 'fresh' => {
  if (settings.identityCheckedAt === null) return 'never-checked';
  return Date.parse(now) - Date.parse(settings.identityCheckedAt) > staleAfterMs
    ? 'stale'
    : 'fresh';
};

export const automationIdempotencyKeySchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  key: z.string().min(1),
  requestMethod: z.string().min(1),
  requestPath: z.string().min(1),
  requestHash: z.string().min(1),
  claimedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
});

export type AutomationIdempotencyKey = z.infer<typeof automationIdempotencyKeySchema>;

export const marketingConsentConfirmation = (input: {
  confirmationUrl: string;
  wording: string;
}): { subject: string; html: string; text: string } => ({
  subject: 'Confirm your e-mail consent',
  html: `<p>Confirm that you requested this consent:</p><p>${escapeHtml(input.wording)}</p><p><a href="${escapeHtml(input.confirmationUrl)}">Confirm consent</a></p>`,
  text: `Confirm that you requested this consent:\n\n${input.wording}\n\n${input.confirmationUrl}`,
});

export const throttleBudget = (input: {
  ratePerSecond: number;
  tickSeconds: number;
  dailyQuota: number;
  sentLast24Hours: number;
  inSandbox: boolean;
}): number => {
  if (input.inSandbox) return 0;
  const rateBudget = Math.max(0, Math.floor(input.ratePerSecond * input.tickSeconds));
  const dailyRemainder = Math.max(0, Math.floor(input.dailyQuota - input.sentLast24Hours));
  return Math.min(rateBudget, dailyRemainder);
};
