import {
  appError,
  buildEmailHeaders,
  campaignCanEditContent,
  campaignCanTransition,
  classifySesEvent,
  deriveConsentState,
  deriveMarketingEligibility,
  err,
  forbidden,
  liftSuppression,
  normalizeEmail,
  notFound,
  ok,
  renderMarketingTemplate,
  throttleBudget,
  validateRenderedMarketingOutput,
  validation,
  type AppError,
  type Campaign,
  type CampaignSend,
  type ConsentEvidence,
  type MarketingConsent,
  type MarketingIneligibilityReason,
  type Result,
  type Suppression,
  type TenantSesSettings,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  AutomationIdempotencyRepository,
  CampaignRepository,
  CampaignSendRepository,
  Clock,
  ConsentConfirmationTokenRepository,
  ConsentDefinitionRepository,
  EmailLayoutRepository,
  EmailHmac,
  EmailOutboxRepository,
  IdGenerator,
  MarketingAudienceRepository,
  MarketingConsentRepository,
  MarketingSesCredentialResolver,
  SesMarketingSender,
  SuppressionRepository,
  TenantSesSettingsRepository,
  TokenGenerator,
  UnsubscribeTokenRepository,
  SchedulerPort,
} from '../ports.js';

const tenantIdFrom = (ctx: Ctx): Result<string, AppError> =>
  ctx.identity.tenantId === null ? err(forbidden('Tenant context is required')) : ok(ctx.identity.tenantId);

const staffTenantIdFrom = (ctx: Ctx): Result<string, AppError> => {
  const tenantId = tenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  return ctx.identity.staffRole === null ? err(forbidden('Tenant staff access is required')) : tenantId;
};

interface ConsentDeps {
  definitions: ConsentDefinitionRepository;
  consents: MarketingConsentRepository;
  confirmations: ConsentConfirmationTokenRepository;
  outbox: EmailOutboxRepository;
  ids: IdGenerator;
  tokens: TokenGenerator;
  clock: Clock;
}

export const createMarketingConsentDefinition = async (
  ctx: Ctx,
  input: {
    key: string;
    label: string;
    doubleOptIn: boolean;
    documentUrl: string;
  },
  deps: Pick<ConsentDeps, 'definitions' | 'ids' | 'clock'>,
): Promise<Result<{ definition: Awaited<ReturnType<ConsentDefinitionRepository['findById']>> }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const parsedUrl = URL.canParse(input.documentUrl);
  if (!parsedUrl) return err(validation('Consent document URL is invalid'));
  const now = deps.clock.nowIso();
  const definition = {
    id: deps.ids.nextId(), tenantId: tenantId.value, key: input.key,
    kind: 'optional_marketing' as const, channel: 'email' as const,
    doubleOptIn: input.doubleOptIn, documentRef: { mode: 'url' as const, url: input.documentUrl },
    status: 'active' as const, createdAt: now, updatedAt: now,
  };
  await deps.definitions.create(tenantId.value, definition, {
    id: deps.ids.nextId(), tenantId: tenantId.value, definitionId: definition.id,
    version: 1, label: input.label, documentVersionRef: { mode: 'url', url: input.documentUrl },
    createdAt: now, createdBy: ctx.identity.userId,
  });
  return ok({ definition });
};

export const listMarketingConsentDefinitions = async (
  ctx: Ctx,
  deps: Pick<ConsentDeps, 'definitions'>,
): Promise<Result<{ definitions: Awaited<ReturnType<ConsentDefinitionRepository['list']>> }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx);
  return tenantId.ok ? ok({ definitions: await deps.definitions.list(tenantId.value) }) : tenantId;
};

export const recordMarketingConsent = async (
  ctx: Ctx,
  input: {
    email: string;
    memberId: string | null;
    definitionId: string;
    evidence: ConsentEvidence;
    source: MarketingConsent['source'];
    confirmationBaseUrl: string;
  },
  deps: ConsentDeps,
): Promise<Result<{ consent: MarketingConsent; state: 'active' | 'pending_confirmation' }, AppError>> => {
  const tenantId = tenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  if (input.evidence.collectedAt.trim() === '' || (input.evidence.proofRef?.trim() ?? '') === '') {
    return err(validation('Explicit consent evidence is required'));
  }
  const definition = await deps.definitions.findById(tenantId.value, input.definitionId);
  if (definition === null || definition.status !== 'active' || definition.kind !== 'optional_marketing') {
    return err(validation('An active optional marketing consent definition is required'));
  }
  const versions = await deps.definitions.listVersions(tenantId.value, definition.id);
  const version = versions.at(-1);
  if (version === undefined) return err(validation('Consent definition has no wording version'));
  const consent: MarketingConsent = {
    id: deps.ids.nextId(), tenantId: tenantId.value, memberId: input.memberId,
    email: normalizeEmail(input.email), definitionId: definition.id, definitionVersion: version.version,
    wordingSnapshot: version.label, documentRefSnapshot: version.documentVersionRef, status: 'granted',
    previousId: null, source: input.source, evidence: input.evidence, occurredAt: input.evidence.collectedAt,
  };
  await deps.consents.record(tenantId.value, consent);
  if (!definition.doubleOptIn) return ok({ consent, state: 'active' });
  const tokenValue = deps.tokens.nextToken();
  const now = deps.clock.nowIso();
  await deps.confirmations.create(tenantId.value, {
    id: deps.ids.nextId(), tenantId: tenantId.value, token: tokenValue, marketingConsentRowId: consent.id,
    createdAt: now, expiresAt: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString(), usedAt: null,
  });
  const queued = await deps.outbox.enqueue({
    id: deps.ids.nextId(), tenantId: tenantId.value, to: consent.email, now,
    payload: {
      kind: 'marketing-consent-confirmation', wording: consent.wordingSnapshot,
      confirmationUrl: `${input.confirmationBaseUrl}/${tokenValue}`,
    },
  });
  return queued.ok ? ok({ consent, state: 'pending_confirmation' }) : queued;
};

export const confirmMarketingConsent = async (
  ctx: Ctx,
  input: { token: string; evidence: ConsentEvidence },
  deps: Pick<ConsentDeps, 'confirmations' | 'consents' | 'ids' | 'clock'>,
): Promise<Result<{ consent: MarketingConsent }, AppError>> => {
  const tenantId = tenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const token = await deps.confirmations.findByToken(tenantId.value, input.token);
  if (token === null) return err(notFound('Consent confirmation token was not found'));
  const now = deps.clock.nowIso();
  const granted = await deps.consents.findById(tenantId.value, token.marketingConsentRowId);
  if (granted === null) return err(notFound('Pending consent was not found'));
  const consumed = await deps.confirmations.consume(tenantId.value, input.token, now);
  if (consumed === null) return err(validation('Consent confirmation token is expired or already used'));
  const confirmed: MarketingConsent = {
    ...granted, id: deps.ids.nextId(), status: 'confirmed', previousId: granted.id,
    evidence: input.evidence, occurredAt: now,
  };
  await deps.consents.record(tenantId.value, confirmed);
  return ok({ consent: confirmed });
};

export const withdrawMarketingConsent = async (
  ctx: Ctx,
  input: { email: string; definitionId: string; evidence: ConsentEvidence },
  deps: Pick<ConsentDeps, 'consents' | 'ids' | 'clock'>,
): Promise<Result<{ consent: MarketingConsent }, AppError>> => {
  const tenantId = tenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const latest = await deps.consents.latestByEmail(tenantId.value, input.email, input.definitionId);
  if (latest === null) return err(notFound('Marketing consent was not found'));
  if (latest.status === 'withdrawn') return ok({ consent: latest });
  const withdrawn: MarketingConsent = {
    ...latest, id: deps.ids.nextId(), status: 'withdrawn', previousId: latest.id,
    source: 'preference_page', evidence: input.evidence, occurredAt: deps.clock.nowIso(),
  };
  await deps.consents.record(tenantId.value, withdrawn);
  return ok({ consent: withdrawn });
};

export const purgeStalePendingConsents = async (
  ctx: Ctx,
  input: { olderThan: string },
  deps: Pick<ConsentDeps, 'consents' | 'definitions'>,
): Promise<Result<{ purged: number }, AppError>> => {
  const tenantId = tenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const definitions = await deps.definitions.list(tenantId.value);
  const doubleOptInDefinitionIds = definitions.filter((definition) => definition.doubleOptIn).map((definition) => definition.id);
  return ok({ purged: await deps.consents.purgeStalePending(tenantId.value, input.olderThan, doubleOptInDefinitionIds) });
};

interface EligibilityDeps {
  definitions: ConsentDefinitionRepository;
  consents: MarketingConsentRepository;
  suppressions: SuppressionRepository;
  hmac: EmailHmac;
}

export const getMarketingEligibility = async (
  ctx: Ctx,
  input: { email: string; definitionId: string },
  deps: EligibilityDeps,
): Promise<Result<{ eligible: boolean; reasons: MarketingIneligibilityReason[]; consent: { definitionId: string; status: string; since: string } | null }, AppError>> => {
  const tenantId = tenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const definition = await deps.definitions.findById(tenantId.value, input.definitionId);
  if (definition === null) return err(notFound('Consent definition was not found'));
  const rows = await deps.consents.listByEmail(tenantId.value, input.email, definition.id);
  const state = deriveConsentState(rows, definition);
  const suppressed = await deps.suppressions.isSuppressed(tenantId.value, deps.hmac.compute(tenantId.value, normalizeEmail(input.email)));
  const eligibility = deriveMarketingEligibility({ consent: state, suppressed });
  return ok({
    eligible: eligibility.eligible,
    reasons: eligibility.eligible ? [] : [eligibility.reason],
    consent: state.row === null ? null : { definitionId: definition.id, status: state.state, since: state.row.occurredAt },
  });
};

interface SuppressionDeps {
  suppressions: SuppressionRepository;
  hmac: EmailHmac;
  ids: IdGenerator;
  clock: Clock;
}

export const addManualSuppression = async (
  ctx: Ctx,
  input: { email: string; sourceRef: string | null },
  deps: SuppressionDeps,
): Promise<Result<Suppression, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const email = normalizeEmail(input.email);
  const existing = await deps.suppressions.findActive(tenantId.value, deps.hmac.compute(tenantId.value, email));
  if (existing !== null) return ok(existing);
  const suppression: Suppression = {
    id: deps.ids.nextId(), tenantId: tenantId.value, email,
    emailHmac: deps.hmac.compute(tenantId.value, email), reason: 'manual', sourceRef: input.sourceRef,
    meta: null, createdAt: deps.clock.nowIso(), liftedAt: null, liftedBy: null,
  };
  await deps.suppressions.record(tenantId.value, suppression);
  return ok(suppression);
};

export const liftMarketingSuppression = async (
  ctx: Ctx,
  input: { suppressionId: string; actorId: string },
  deps: Pick<SuppressionDeps, 'suppressions' | 'clock'>,
): Promise<Result<Suppression, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const suppression = await deps.suppressions.findById(tenantId.value, input.suppressionId);
  if (suppression === null) return err(notFound('Suppression was not found'));
  const lifted = liftSuppression(suppression, { actorId: input.actorId, liftedAt: deps.clock.nowIso() });
  if (!lifted.ok) return lifted;
  const stored = await deps.suppressions.lift(tenantId.value, lifted.value);
  return stored === null ? err(validation('Suppression could not be lifted')) : ok(stored);
};

interface UnsubscribeDeps extends EligibilityDeps {
  unsubscribes: UnsubscribeTokenRepository;
  ids: IdGenerator;
  clock: Clock;
}

export const getUnsubscribePreferences = async (
  ctx: Ctx,
  input: { token: string },
  deps: UnsubscribeDeps,
): Promise<Result<{ email: string; scope: string; definitions: Array<{ id: string; active: boolean }> }, AppError>> => {
  const tenantId = tenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const token = await deps.unsubscribes.findByToken(tenantId.value, input.token);
  if (token === null) return err(notFound('Unsubscribe token was not found'));
  const definitions = (await deps.definitions.list(tenantId.value, 'active'))
    .filter((definition) => definition.kind === 'optional_marketing');
  const states = await Promise.all(definitions.map(async (definition) => ({
    id: definition.id,
    active: deriveConsentState(await deps.consents.listByEmail(tenantId.value, token.email, definition.id), definition).active,
  })));
  return ok({ email: token.email, scope: token.scope, definitions: states });
};

export const unsubscribeOneClick = async (
  ctx: Ctx,
  input: { token: string },
  deps: UnsubscribeDeps,
): Promise<Result<{ unsubscribed: true }, AppError>> => {
  const tenantId = tenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const consumed = await deps.unsubscribes.consume(tenantId.value, input.token, deps.clock.nowIso());
  if (consumed === null) return err(notFound('Unsubscribe token was not found'));
  if (!consumed.newlyUsed) return ok({ unsubscribed: true });
  const definitions = consumed.token.scope === 'all_marketing'
    ? (await deps.definitions.list(tenantId.value, 'active')).filter((definition) => definition.kind === 'optional_marketing')
    : [await deps.definitions.findById(tenantId.value, consumed.token.scope.slice('consent:'.length))].filter((value) => value !== null);
  for (const definition of definitions) {
    await withdrawMarketingConsent(ctx, {
      email: consumed.token.email, definitionId: definition.id, evidence: { collectedAt: deps.clock.nowIso() },
    }, deps);
  }
  if (consumed.token.scope === 'all_marketing') {
    const emailHmac = deps.hmac.compute(tenantId.value, consumed.token.email);
    await deps.suppressions.record(tenantId.value, {
      id: deps.ids.nextId(), tenantId: tenantId.value, email: consumed.token.email, emailHmac,
      reason: 'unsubscribe_global', sourceRef: consumed.token.id, meta: null, createdAt: deps.clock.nowIso(),
      liftedAt: null, liftedBy: null,
    });
  }
  return ok({ unsubscribed: true });
};

interface CampaignDeps {
  campaigns: CampaignRepository;
  audience: MarketingAudienceRepository;
  definitions: ConsentDefinitionRepository;
  ids: IdGenerator;
  clock: Clock;
  scheduler: SchedulerPort;
}

export const createCampaign = async (
  ctx: Ctx,
  input: { name: string; subject: string; bodyHtml: string; consentDefinitionId: string },
  deps: CampaignDeps,
): Promise<Result<Campaign, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const now = deps.clock.nowIso();
  const campaign: Campaign = {
    id: deps.ids.nextId(), tenantId: tenantId.value, name: input.name, subject: input.subject,
    bodyHtml: input.bodyHtml, bodySource: input.bodyHtml, layoutId: null, consentDefinitionId: input.consentDefinitionId,
    audienceFilter: null, status: 'draft', sendAt: null, snapshotMaxMemberId: null, cursorMemberId: null,
    toSend: 0, sent: 0, failed: 0, lockedUntil: null, lockedBy: null, errorCount: 0, pausedReason: null,
    audienceNameSnapshot: null, consentLabelSnapshot: null, startedAt: null, finishedAt: null, createdAt: now,
  };
  await deps.campaigns.create(tenantId.value, campaign);
  return ok(campaign);
};

export const getCampaign = async (
  ctx: Ctx,
  input: { campaignId: string },
  deps: Pick<CampaignDeps, 'campaigns'>,
): Promise<Result<Campaign, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const campaign = await deps.campaigns.findById(tenantId.value, input.campaignId);
  return campaign === null ? err(notFound('Campaign was not found')) : ok(campaign);
};

export const listCampaigns = async (
  ctx: Ctx,
  deps: Pick<CampaignDeps, 'campaigns'>,
): Promise<Result<Campaign[], AppError>> => {
  const tenantId = staffTenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  return ok(await deps.campaigns.list(tenantId.value));
};

export const deleteCampaign = async (
  ctx: Ctx,
  input: { campaignId: string },
  deps: Pick<CampaignDeps, 'campaigns'>,
): Promise<Result<{ deleted: true }, AppError>> => {
  const campaign = await getCampaign(ctx, input, deps);
  if (!campaign.ok) return campaign;
  if (campaign.value.status !== 'draft') return err(validation('Only draft campaigns can be deleted'));
  return await deps.campaigns.delete(campaign.value.tenantId, campaign.value.id)
    ? ok({ deleted: true })
    : err(notFound('Campaign was not found'));
};

const transitionCampaign = async (
  ctx: Ctx,
  campaignId: string,
  status: Campaign['status'],
  deps: CampaignDeps,
  changes: Partial<Campaign> = {},
): Promise<Result<Campaign, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const campaign = await deps.campaigns.findById(tenantId.value, campaignId);
  if (campaign === null) return err(notFound('Campaign was not found'));
  if (!campaignCanTransition(campaign.status, status)) return err(validation(`Campaign cannot transition from ${campaign.status} to ${status}`));
  const updated = await deps.campaigns.update(tenantId.value, { ...campaign, ...changes, status });
  return updated === null ? err(notFound('Campaign was not found')) : ok(updated);
};

export const scheduleCampaign = async (
  ctx: Ctx,
  input: { campaignId: string; sendAt: string },
  deps: CampaignDeps,
): Promise<Result<Campaign, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const sendAt = Date.parse(input.sendAt);
  if (!Number.isFinite(sendAt) || new Date(sendAt).toISOString() !== input.sendAt) {
    return err(validation('Campaign schedule requires an ISO timestamp'));
  }
  const campaign = await deps.campaigns.findById(tenantId.value, input.campaignId);
  if (campaign === null) return err(notFound('Campaign was not found'));
  const definition = await deps.definitions.findById(tenantId.value, campaign.consentDefinitionId);
  if (definition === null || definition.status !== 'active') return err(validation('Campaign requires an active consent definition'));
  const versions = await deps.definitions.listVersions(tenantId.value, definition.id);
  const version = versions.at(-1);
  if (version === undefined) return err(validation('Consent definition has no wording version'));
  const productIds = campaign.audienceFilter?.productIds ?? [];
  const snapshot = await deps.audience.snapshot(tenantId.value, { definitionId: definition.id, productIds });
  const scheduled = await transitionCampaign(ctx, input.campaignId, 'scheduled', deps, {
    sendAt: input.sendAt,
    snapshotMaxMemberId: snapshot.maxMemberId,
    cursorMemberId: null,
    toSend: snapshot.count,
    sent: 0,
    failed: 0,
    errorCount: 0,
    pausedReason: null,
    audienceNameSnapshot: productIds.length === 0 ? 'All members' : `Products: ${productIds.join(', ')}`,
    consentLabelSnapshot: version.label,
  });
  if (!scheduled.ok) return scheduled;
  const queued = await deps.scheduler.scheduleCampaignTick(scheduled.value.tenantId, scheduled.value.id, input.sendAt);
  return queued.ok ? scheduled : queued;
};

export const pauseCampaign = async (
  ctx: Ctx,
  input: { campaignId: string; resume?: boolean },
  deps: CampaignDeps,
): Promise<Result<Campaign, AppError>> => transitionCampaign(ctx, input.campaignId, input.resume === true ? 'running' : 'paused', deps, {
  pausedReason: input.resume === true ? null : 'Paused by staff', lockedUntil: null, lockedBy: null,
});

export const cancelCampaign = (
  ctx: Ctx,
  input: { campaignId: string },
  deps: CampaignDeps,
): Promise<Result<Campaign, AppError>> => transitionCampaign(ctx, input.campaignId, 'cancelled', deps);

export const updateCampaignContent = async (
  ctx: Ctx,
  input: { campaignId: string; subject: string; bodyHtml: string },
  deps: CampaignDeps,
): Promise<Result<Campaign, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const campaign = await deps.campaigns.findById(tenantId.value, input.campaignId);
  if (campaign === null) return err(notFound('Campaign was not found'));
  if (!campaignCanEditContent(campaign.status)) return err(validation('Campaign content is locked in this state'));
  const updated = await deps.campaigns.update(tenantId.value, { ...campaign, subject: input.subject, bodyHtml: input.bodyHtml, bodySource: input.bodyHtml });
  return updated === null ? err(notFound('Campaign was not found')) : ok(updated);
};

interface SendDeps extends EligibilityDeps {
  layouts: EmailLayoutRepository;
  sends: CampaignSendRepository;
  unsubscribes: UnsubscribeTokenRepository;
  sesSettings: TenantSesSettingsRepository;
  ses: SesMarketingSender;
  credentials: MarketingSesCredentialResolver;
  ids: IdGenerator;
  tokens: TokenGenerator;
  clock: Clock;
  unsubscribeBaseUrl: string;
}

export interface MarketingMessageInput {
  to: string;
  memberId: string | null;
  campaignId: string | null;
  source: CampaignSend['source'];
  consentDefinitionId: string;
  subject: string;
  bodyHtml: string;
  layoutId?: string | null;
  data: Record<string, unknown>;
  idempotencySource?: string;
}

export type MarketingSendResult =
  | { to: string; sendId: string; status: 'sent' }
  | { to: string; sendId: string | null; status: 'skipped'; reason: MarketingIneligibilityReason }
  | { to: string; sendId: string; status: 'failed'; error: AppError }
  | { to: string; sendId: null; status: 'deduplicated' };

const textFromHtml = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const recordValue = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

const renderMarketingPayload = (input: {
  subject: string;
  bodyHtml: string;
  data: Record<string, unknown>;
  unsubscribeUrl: string;
  legalName: string;
  address: string;
  consentReference: string;
  layoutHtml: string | null;
}): Result<{ subject: string; html: string; text: string; headers: Record<string, string> }, AppError> => {
  const footer = `<footer><p>${input.legalName}</p><p>${input.address}</p><p>${input.consentReference}</p><p><a href="${input.unsubscribeUrl}">Unsubscribe</a></p></footer>`;
  const content = renderMarketingTemplate(`${input.bodyHtml}${footer}`, input.data);
  if (!content.ok) return content;
  const body = input.layoutHtml === null
    ? content
    : renderMarketingTemplate(input.layoutHtml, { ...input.data, content: content.value });
  if (!body.ok) return body;
  const subject = renderMarketingTemplate(input.subject, input.data);
  if (!subject.ok) return subject;
  const valid = validateRenderedMarketingOutput(body.value, {
    unsubscribeUrl: input.unsubscribeUrl,
    legalName: input.legalName,
    address: input.address,
    consentReference: input.consentReference,
  });
  if (!valid.ok) return valid;
  const headers = buildEmailHeaders({ kind: 'marketing', unsubscribeUrl: input.unsubscribeUrl });
  if (!headers.ok) return headers;
  return ok({ subject: subject.value, html: body.value, text: textFromHtml(body.value), headers: headers.value });
};

const eligibilityFor = async (tenantId: string, input: MarketingMessageInput, deps: SendDeps) => {
  const definition = await deps.definitions.findById(tenantId, input.consentDefinitionId);
  if (definition === null) return null;
  const rows = await deps.consents.listByEmail(tenantId, input.to, definition.id);
  const consent = deriveConsentState(rows, definition);
  const suppressed = await deps.suppressions.isSuppressed(tenantId, deps.hmac.compute(tenantId, normalizeEmail(input.to)));
  return { eligibility: deriveMarketingEligibility({ consent, suppressed }), latest: consent.row };
};

export const sendMarketingMessages = async (
  ctx: Ctx,
  inputs: MarketingMessageInput[],
  deps: SendDeps,
): Promise<Result<MarketingSendResult[], AppError>> => {
  const tenantId = tenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const settings = await deps.sesSettings.findByTenant(tenantId.value);
  if (settings === null) return err(appError('ses_not_configured', 'Tenant SES is not configured'));
  if (!settings.broadcastsEnabled) return err(appError('broadcasts_disabled', 'Marketing broadcasts are disabled'));
  const credentials = await deps.credentials.resolve(tenantId.value);
  if (!credentials.ok) return credentials;
  const results: MarketingSendResult[] = [];
  for (const input of inputs) {
    const initial = await eligibilityFor(tenantId.value, input, deps);
    if (initial === null) return err(notFound('Consent definition was not found'));
    if (!initial.eligibility.eligible) {
      const skippedId = input.campaignId === null || initial.latest === null ? null : deps.ids.nextId();
      if (skippedId !== null && initial.latest !== null) {
        const skipped: CampaignSend = {
          id: skippedId, tenantId: tenantId.value, campaignId: input.campaignId, source: input.source,
          memberId: input.memberId, email: normalizeEmail(input.to), consentRowId: initial.latest.id,
          unsubscribeTokenId: null, status: 'skipped', skipReason: initial.eligibility.reason,
          sesMessageId: null, deliveryStatus: null, deliveryOccurredAt: null,
          idempotencySource: input.idempotencySource ?? null, renderedBodyPurgedAt: null,
          createdAt: deps.clock.nowIso(), sentAt: null,
        };
        await deps.sends.claimRecipient(tenantId.value, skipped);
      }
      results.push({ to: normalizeEmail(input.to), sendId: skippedId, status: 'skipped', reason: initial.eligibility.reason });
      continue;
    }
    const sendId = deps.ids.nextId();
    const send: CampaignSend = {
      id: sendId, tenantId: tenantId.value, campaignId: input.campaignId, source: input.source,
      memberId: input.memberId, email: normalizeEmail(input.to), consentRowId: initial.eligibility.consentRow.id,
      unsubscribeTokenId: null, status: 'pending', skipReason: null, sesMessageId: null,
      deliveryStatus: null, deliveryOccurredAt: null, idempotencySource: input.idempotencySource ?? null,
      renderedBodyPurgedAt: null, createdAt: deps.clock.nowIso(), sentAt: null,
    };
    if (!await deps.sends.claimRecipient(tenantId.value, send)) {
      results.push({ to: send.email, sendId: null, status: 'deduplicated' });
      continue;
    }
    const dequeue = await eligibilityFor(tenantId.value, input, deps);
    if (dequeue === null) {
      await deps.sends.update(tenantId.value, { ...send, status: 'skipped', skipReason: 'not_consented' });
      results.push({ to: send.email, sendId, status: 'skipped', reason: 'not_consented' });
      continue;
    }
    if (!dequeue.eligibility.eligible) {
      const reason = dequeue.eligibility.reason;
      await deps.sends.update(tenantId.value, { ...send, status: 'skipped', skipReason: reason });
      results.push({ to: send.email, sendId, status: 'skipped', reason });
      continue;
    }
    const unsubscribeTokenId = deps.ids.nextId();
    const token = deps.tokens.nextToken();
    const unsubscribeUrl = `${deps.unsubscribeBaseUrl}/${token}`;
    await deps.unsubscribes.create(tenantId.value, {
      id: unsubscribeTokenId, tenantId: tenantId.value, token, email: send.email, memberId: input.memberId,
      campaignSendId: sendId, scope: `consent:${input.consentDefinitionId}`, createdAt: deps.clock.nowIso(), usedAt: null,
    });
    const layout = input.layoutId === undefined || input.layoutId === null
      ? null
      : await deps.layouts.findById(tenantId.value, input.layoutId);
    if (input.layoutId !== undefined && input.layoutId !== null && layout === null) {
      await deps.sends.update(tenantId.value, { ...send, unsubscribeTokenId, status: 'failed' });
      results.push({
        to: send.email,
        sendId,
        status: 'failed',
        error: notFound('Marketing e-mail layout was not found'),
      });
      continue;
    }
    const rendered = renderMarketingPayload({
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      data: {
        ...input.data,
        member: { ...recordValue(input.data['member']), email: send.email },
        tenant: {
          ...recordValue(input.data['tenant']),
          name: ctx.identity.tenantName ?? settings.fromName,
          legalName: settings.footerLegalName,
          address: settings.footerAddress,
        },
        brand: {
          ...recordValue(input.data['brand']),
          name: settings.fromName,
          identity: settings.identity,
        },
        unsubscribeUrl,
      },
      unsubscribeUrl,
      legalName: settings.footerLegalName,
      address: settings.footerAddress,
      consentReference: dequeue.eligibility.consentRow.wordingSnapshot,
      layoutHtml: layout?.bodyHtml ?? null,
    });
    if (!rendered.ok) {
      await deps.sends.update(tenantId.value, { ...send, unsubscribeTokenId, status: 'failed' });
      results.push({ to: send.email, sendId, status: 'failed', error: rendered.error });
      continue;
    }
    const sending = { ...send, unsubscribeTokenId, status: 'sending' as const };
    await deps.sends.update(tenantId.value, sending);
    const sent = await deps.ses.send({
      credentials: credentials.value, from: { address: settings.fromAddress, name: settings.fromName },
      to: send.email, subject: rendered.value.subject, html: rendered.value.html, text: rendered.value.text,
      headers: rendered.value.headers, configurationSet: settings.configurationSet,
    });
    if (!sent.ok) {
      await deps.sends.update(tenantId.value, { ...sending, status: 'failed' });
      results.push({ to: send.email, sendId, status: 'failed', error: sent.error });
      continue;
    }
    await deps.sends.update(tenantId.value, {
      ...sending, status: 'sent', sesMessageId: sent.value.messageId, sentAt: deps.clock.nowIso(),
    });
    results.push({ to: send.email, sendId, status: 'sent' });
  }
  return ok(results);
};

interface TickDeps extends SendDeps {
  campaigns: CampaignRepository;
  audience: MarketingAudienceRepository;
  outbox: EmailOutboxRepository;
}

export const campaignTick = async (
  ctx: Ctx,
  input: { campaignId: string; workerId: string; tickSeconds: number; errorThreshold?: number },
  deps: TickDeps,
): Promise<Result<{ leased: boolean; yieldedToTransactional: boolean; sent: number; failed: number; skipped: number }, AppError>> => {
  const tenantId = tenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  let campaign = await deps.campaigns.findById(tenantId.value, input.campaignId);
  if (campaign === null) return err(notFound('Campaign was not found'));
  const now = deps.clock.nowIso();
  if (campaign.status === 'scheduled' && campaign.sendAt !== null && campaign.sendAt <= now) {
    campaign = await deps.campaigns.update(tenantId.value, { ...campaign, status: 'running', startedAt: now });
    if (campaign === null) return err(notFound('Campaign was not found'));
  }
  if (campaign.status !== 'running') return ok({ leased: false, yieldedToTransactional: false, sent: 0, failed: 0, skipped: 0 });
  const leased = await deps.campaigns.acquireLease(tenantId.value, campaign.id, {
    workerId: input.workerId, now, lockedUntil: new Date(Date.parse(now) + input.tickSeconds * 1000).toISOString(),
  });
  if (!leased) return ok({ leased: false, yieldedToTransactional: false, sent: 0, failed: 0, skipped: 0 });
  if (deps.outbox.hasPendingForTenant !== undefined && await deps.outbox.hasPendingForTenant(tenantId.value)) {
    return ok({ leased: true, yieldedToTransactional: true, sent: 0, failed: 0, skipped: 0 });
  }
  const settings = await deps.sesSettings.findByTenant(tenantId.value);
  if (settings === null) return err(appError('ses_not_configured', 'Tenant SES is not configured'));
  const sentSince = new Date(Date.parse(now) - 24 * 60 * 60 * 1000).toISOString();
  const sentLast24Hours = (await deps.sends.listAll(tenantId.value))
    .filter((send) => send.status === 'sent' && send.sentAt !== null && send.sentAt >= sentSince)
    .length;
  const budget = throttleBudget({
    ratePerSecond: settings.quotaRatePerSec, tickSeconds: input.tickSeconds,
    dailyQuota: settings.quotaDaily, sentLast24Hours, inSandbox: settings.inSandbox,
  });
  const maxMemberId = campaign.snapshotMaxMemberId;
  if (maxMemberId === null && campaign.toSend === 0) {
    await deps.campaigns.update(tenantId.value, { ...campaign, status: 'finished', finishedAt: now });
    return ok({ leased: true, yieldedToTransactional: false, sent: 0, failed: 0, skipped: 0 });
  }
  if (budget === 0 || maxMemberId === null) return ok({ leased: true, yieldedToTransactional: false, sent: 0, failed: 0, skipped: 0 });
  const members = await deps.audience.fetchEligibleBatch(tenantId.value, {
    definitionId: campaign.consentDefinitionId, productIds: campaign.audienceFilter?.productIds ?? [],
    afterMemberId: campaign.cursorMemberId, maxMemberId, limit: budget,
  });
  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let lastCursor = campaign.cursorMemberId;
  let current = campaign;
  let lastError: string | null = null;
  let consecutiveErrors = campaign.errorCount;
  for (const member of members) {
    const outcome = await sendMarketingMessages(ctx, [{
      to: member.email, memberId: member.memberId, campaignId: campaign.id, source: 'broadcast',
      consentDefinitionId: campaign.consentDefinitionId, subject: campaign.subject,
      bodyHtml: campaign.bodyHtml, layoutId: campaign.layoutId,
      data: { member: { email: member.email, name: member.displayName } },
    }], deps);
    if (!outcome.ok) return outcome;
    const item = outcome.value[0];
    if (item?.status === 'sent') {
      sentCount += 1;
      consecutiveErrors = 0;
      lastError = null;
    }
    else if (item?.status === 'failed') {
      failedCount += 1;
      consecutiveErrors += 1;
      lastError = item.error.message;
    }
    else if (item?.status === 'skipped') skippedCount += 1;
    lastCursor = member.memberId;
    const advanced = await deps.campaigns.advanceCursor(tenantId.value, campaign.id, {
      cursorMemberId: member.memberId, sentDelta: item?.status === 'sent' ? 1 : 0, failedDelta: item?.status === 'failed' ? 1 : 0,
    });
    if (advanced !== null) current = advanced;
  }
  if (members.length > 0) {
    current = { ...current, errorCount: consecutiveErrors, pausedReason: lastError };
    if (consecutiveErrors >= (input.errorThreshold ?? 3)) current.status = 'paused';
    await deps.campaigns.update(tenantId.value, current);
  }
  const reachedEnd = members.length < budget || lastCursor === maxMemberId;
  if (reachedEnd && current.status === 'running' && !await deps.sends.hasPendingByCampaign(tenantId.value, campaign.id)) {
    await deps.campaigns.update(tenantId.value, { ...current, status: 'finished', finishedAt: now });
  }
  return ok({ leased: true, yieldedToTransactional: false, sent: sentCount, failed: failedCount, skipped: skippedCount });
};

export const testSendCampaignToSelf = async (
  ctx: Ctx,
  input: { campaignId: string },
  deps: TickDeps,
): Promise<Result<{ messageId: string }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const campaign = await deps.campaigns.findById(tenantId.value, input.campaignId);
  const settings = await deps.sesSettings.findByTenant(tenantId.value);
  if (campaign === null) return err(notFound('Campaign was not found'));
  if (settings === null) return err(appError('ses_not_configured', 'Tenant SES is not configured'));
  if (!settings.broadcastsEnabled) return err(appError('broadcasts_disabled', 'Marketing broadcasts are disabled'));
  const credentials = await deps.credentials.resolve(tenantId.value);
  if (!credentials.ok) return credentials;
  const versions = await deps.definitions.listVersions(tenantId.value, campaign.consentDefinitionId);
  const consentReference = campaign.consentLabelSnapshot ?? versions.at(-1)?.label;
  if (consentReference === undefined) return err(validation('Consent definition has no wording version'));
  const layout = campaign.layoutId === null ? null : await deps.layouts.findById(tenantId.value, campaign.layoutId);
  if (campaign.layoutId !== null && layout === null) return err(notFound('Marketing e-mail layout was not found'));
  const unsubscribeTokenId = deps.ids.nextId();
  const token = deps.tokens.nextToken();
  const unsubscribeUrl = `${deps.unsubscribeBaseUrl}/${token}`;
  await deps.unsubscribes.create(tenantId.value, {
    id: unsubscribeTokenId,
    tenantId: tenantId.value,
    token,
    email: ctx.identity.email,
    memberId: null,
    campaignSendId: null,
    scope: `consent:${campaign.consentDefinitionId}`,
    createdAt: deps.clock.nowIso(),
    usedAt: null,
  });
  const rendered = renderMarketingPayload({
    subject: campaign.subject,
    bodyHtml: campaign.bodyHtml,
    data: {
      member: { email: ctx.identity.email, name: ctx.identity.name },
      tenant: {
        name: ctx.identity.tenantName ?? settings.fromName,
        legalName: settings.footerLegalName,
        address: settings.footerAddress,
      },
      brand: { name: settings.fromName, identity: settings.identity },
      unsubscribeUrl,
    },
    unsubscribeUrl,
    legalName: settings.footerLegalName,
    address: settings.footerAddress,
    consentReference,
    layoutHtml: layout?.bodyHtml ?? null,
  });
  if (!rendered.ok) return rendered;
  return deps.ses.send({
    credentials: credentials.value, from: { address: settings.fromAddress, name: settings.fromName }, to: ctx.identity.email,
    subject: `[TEST] ${rendered.value.subject}`, html: rendered.value.html, text: rendered.value.text,
    headers: rendered.value.headers,
    configurationSet: settings.configurationSet,
  });
};

export const claimIdempotencyKey = async (
  ctx: Ctx,
  input: { key: string; method: string; path: string; requestHash: string; ttlSeconds: number },
  deps: { repository: AutomationIdempotencyRepository; ids: IdGenerator; clock: Clock },
): Promise<Result<{ claimed: true }, AppError>> => {
  const tenantId = tenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const now = deps.clock.nowIso();
  const existing = await deps.repository.claim(tenantId.value, {
    id: deps.ids.nextId(), tenantId: tenantId.value, key: input.key, requestMethod: input.method,
    requestPath: input.path, requestHash: input.requestHash, claimedAt: now,
    expiresAt: new Date(Date.parse(now) + input.ttlSeconds * 1000).toISOString(),
  });
  return existing === null
    ? ok({ claimed: true })
    : err(appError('conflict', 'Idempotency key was already used', {
      requestMethod: existing.requestMethod, requestPath: existing.requestPath,
      requestHash: existing.requestHash, claimedAt: existing.claimedAt,
    }));
};

export const completeIdempotentRequest = async (
  ctx: Ctx,
  input: { key: string; status: number },
  deps: { repository: AutomationIdempotencyRepository },
): Promise<Result<void, AppError>> => {
  const tenantId = tenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  if (input.status >= 400 && input.status < 500) await deps.repository.release(tenantId.value, input.key);
  return ok(undefined);
};

type VerifiedSesEvent = {
  topicArn: string;
  messageId: string;
  occurredAt: string;
  raw: unknown;
} & ({ kind: 'delivery' } | { kind: 'complaint' } | { kind: 'bounce'; bounceType: string; status: string | null });

export const applyVerifiedSesEvent = async (
  ctx: Ctx,
  event: VerifiedSesEvent,
  deps: Pick<SendDeps, 'sesSettings' | 'sends' | 'suppressions' | 'hmac' | 'ids' | 'clock'>,
): Promise<Result<{ processed: boolean }, AppError>> => {
  const tenantId = tenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  let settings: TenantSesSettings | null;
  try {
    settings = await deps.sesSettings.findByTenant(tenantId.value);
  } catch {
    return ok({ processed: false });
  }
  if (settings === null || settings.snsTopicArn !== event.topicArn) return err(forbidden('SNS topic does not match this tenant'));
  try {
    const send = await deps.sends.correlateBySesMessageId(tenantId.value, event.messageId);
    if (send === null) return ok({ processed: false });
    if (event.kind === 'delivery') {
      await deps.sends.update(tenantId.value, { ...send, deliveryStatus: 'delivered', deliveryOccurredAt: event.occurredAt });
      return ok({ processed: true });
    }
    const classification = classifySesEvent(event);
    const deliveryStatus = classification === 'complaint' ? 'complained' : 'bounced';
    await deps.sends.update(tenantId.value, { ...send, deliveryStatus, deliveryOccurredAt: event.occurredAt });
    if (classification !== 'soft') {
      await deps.suppressions.record(tenantId.value, {
        id: deps.ids.nextId(), tenantId: tenantId.value, email: send.email,
        emailHmac: deps.hmac.compute(tenantId.value, send.email),
        reason: classification === 'complaint' ? 'complaint' : 'hard_bounce', sourceRef: send.id,
        meta: event.raw, createdAt: deps.clock.nowIso(), liftedAt: null, liftedBy: null,
      });
    }
    return ok({ processed: true });
  } catch {
    return ok({ processed: false });
  }
};

export const runMarketingRetentionJobs = async (
  ctx: Ctx,
  input: { pendingOlderThan: string; renderedBodiesOlderThan: string; idempotencyNow: string },
  deps: Pick<ConsentDeps, 'consents' | 'definitions' | 'clock'> & { sends: CampaignSendRepository; idempotency: AutomationIdempotencyRepository },
): Promise<Result<{ pendingConsentsPurged: number; renderedBodiesPurged: number; idempotencyKeysPurged: number }, AppError>> => {
  const tenantId = tenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const definitions = await deps.definitions.list(tenantId.value);
  const doubleOptInDefinitionIds = definitions.filter((definition) => definition.doubleOptIn).map((definition) => definition.id);
  const pendingConsentsPurged = await deps.consents.purgeStalePending(tenantId.value, input.pendingOlderThan, doubleOptInDefinitionIds);
  const renderedBodiesPurged = await deps.sends.ageOutRenderedBodies(tenantId.value, input.renderedBodiesOlderThan, deps.clock.nowIso());
  const idempotencyKeysPurged = await deps.idempotency.sweepExpired(input.idempotencyNow);
  return ok({ pendingConsentsPurged, renderedBodiesPurged, idempotencyKeysPurged });
};

export const scheduleMarketingRetentionJobs = async (
  ctx: Ctx,
  deps: { scheduler: SchedulerPort },
): Promise<Result<void, AppError>> => {
  const tenantId = tenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  return deps.scheduler.enqueueRetentionJobs(tenantId.value);
};
