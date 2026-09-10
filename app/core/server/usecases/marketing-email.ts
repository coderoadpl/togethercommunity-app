import type { ContactCampaignAudience } from '#core/domain/marketing-audience.js';
import type { MarketingContactAudienceDeps, MarketingContactAudienceRepository } from '../marketing-audience-ports.js';
import { scheduleMarketingContactCampaign } from './marketing-contact-campaigns.js';
import { prepareMarketingContactAudience } from './marketing-contact-audience.js';
import type { MarketingContactRepository } from '../marketing-contact-ports.js';
import { dispatchMarketingOutbox, marketingSendBudget } from './marketing-dispatch.js';
import type { SesEventApplication, VerifiedSesEvent } from '#core/domain/marketing-sns-inbox.js';
import type { MarketingDeliveryRepos, MarketingDeliveryTransaction, MarketingSnsInboxRepository, MarketingOutboxRepository, MarketingWaiter, HtmlToText } from '../marketing-delivery-ports.js';
import { renderMarketingPayload } from './marketing-render.js';
import {
  appError,
  bounceAction,
  campaignCanTransition,
  classifySesEvent,
  deriveConsentState,
  deriveEmailReputation,
  deriveMarketingEligibility,
  emailEventSchema,
  err,
  forbidden,
  isSmokeTenant,
  liftSuppression,
  marketingFooterCopy,
  normalizeEmail,
  notFound,
  ok,
  resolveEmailLanguage,
  reputationWindow,
  tenantSesBroadcastsReady,
  validation,
  type AppError,
  type Capability,
  type Campaign,
  type CampaignEngagementStats,
  type CampaignSend,
  type ConsentDocumentRef,
  type ConsentDocumentVersionRef,
  type ConsentEvidence,
  type EmailEvent,
  type Language,
  type MarketingConsent,
  type MarketingIneligibilityReason,
  type Result,
  type Suppression,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeRequiredTenant } from '../authorize.js';
import type {
  AutomationIdempotencyRepository,
  CampaignRepository,
  CampaignSendRepository,
  Clock,
  ConsentConfirmationTokenRepository,
  ConsentDefinitionRepository,
  EmailLayoutRepository,
  EmailHmac,
  EmailEventRepository,
  EmailOutboxRepository,
  IdGenerator,
  MarketingAudienceRepository,
  MarketingConsentRepository,
  MarketingJobRepository,
  MarketingSesCredentialResolver,
  MarketingThrottleRepository,
  MemberRepository,
  SesMarketingQuotaReader,
  SesMarketingSender,
  SuppressionRepository,
  TenantRepository,
  TenantSesSettingsRepository,
  TenantDocumentRepository,
  TokenGenerator,
  UnsubscribeTokenRepository,
  SchedulerPort,
  SchedulerRunRepository,
} from '../ports.js';

const tenantIdFrom = (ctx: Ctx, capability: Capability): Result<string, AppError> =>
  authorizeRequiredTenant(ctx, capability);

const staffTenantIdFrom = tenantIdFrom;

interface ConsentDeps {
  definitions: ConsentDefinitionRepository;
  consents: MarketingConsentRepository;
  confirmations: ConsentConfirmationTokenRepository;
  members: MemberRepository;
  tenants: TenantRepository;
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
    footerLabel?: string | null | undefined;
    documentUrl?: string;
    documentRef?: ConsentDocumentRef;
  },
  deps: Pick<ConsentDeps, 'definitions' | 'ids' | 'clock'> & { documents?: TenantDocumentRepository },
): Promise<Result<{ definition: Awaited<ReturnType<ConsentDefinitionRepository['findById']>> }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:consent-definition:write');
  if (!tenantId.ok) return tenantId;
  const documentRef: ConsentDocumentRef | null = input.documentRef
    ?? (input.documentUrl === undefined ? null : { mode: 'url', url: input.documentUrl });
  if (documentRef === null) return err(validation('Consent document reference is required'));
  let documentVersionRef: ConsentDocumentVersionRef;
  if (documentRef.mode === 'url') {
    if (!URL.canParse(documentRef.url)) return err(validation('Consent document URL is invalid'));
    documentVersionRef = documentRef;
  } else {
    if (deps.documents === undefined) return err(validation('Hosted documents are unavailable'));
    const versions = await deps.documents.listVersions(tenantId.value, documentRef.documentId);
    const published = versions.filter((version) => version.publishedAt !== null).at(-1);
    if (published === undefined) return err(validation('Hosted consent document must be published'));
    documentVersionRef = { mode: 'hosted', documentVersionId: published.id };
  }
  const now = deps.clock.nowIso();
  const definition = {
    id: deps.ids.nextId(), tenantId: tenantId.value, key: input.key,
    kind: 'optional_marketing' as const, channel: 'email' as const,
    doubleOptIn: input.doubleOptIn, footerLabel: input.footerLabel ?? null, documentRef,
    status: 'active' as const, createdAt: now, updatedAt: now,
  };
  await deps.definitions.create(tenantId.value, definition, {
    id: deps.ids.nextId(), tenantId: tenantId.value, definitionId: definition.id,
    version: 1, label: input.label, documentVersionRef,
    createdAt: now, createdBy: ctx.identity.userId,
  });
  return ok({ definition });
};

export const listMarketingConsentDefinitions = async (
  ctx: Ctx,
  deps: Pick<ConsentDeps, 'definitions'>,
): Promise<Result<{ definitions: Awaited<ReturnType<ConsentDefinitionRepository['list']>> }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:consent-definition:read');
  return tenantId.ok ? ok({ definitions: await deps.definitions.list(tenantId.value) }) : tenantId;
};

const confirmationTokenTtlMs = 24 * 60 * 60 * 1000;

const consentEmailLanguage = (
  tenantId: string,
  email: string,
  deps: Pick<ConsentDeps, 'members' | 'tenants'>,
): (() => Promise<Language>) => {
  let pending: Promise<Language> | undefined;
  return () => (pending ??= (async () => {
    const [recipient, settings] = await Promise.all([
      deps.members.findByEmail(tenantId, normalizeEmail(email)),
      deps.tenants.findSettings(tenantId),
    ]);
    return resolveEmailLanguage(recipient?.language, settings?.defaultLanguage);
  })());
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
    resolveLanguage?: (() => Promise<Language>) | undefined;
  },
  deps: ConsentDeps,
): Promise<Result<{ consent: MarketingConsent; state: 'active' | 'pending_confirmation' }, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'marketing:consent:write');
  if (!tenantId.ok) return tenantId;
  if (input.evidence.collectedAt.trim() === '' || (input.evidence.proofRef?.trim() ?? '') === '') {
    return err(validation('Explicit consent evidence is required'));
  }
  if (Date.parse(input.evidence.collectedAt) > Date.parse(deps.clock.nowIso())) {
    return err(validation('Consent evidence cannot be dated in the future'));
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
    createdAt: now, expiresAt: new Date(Date.parse(now) + confirmationTokenTtlMs).toISOString(), usedAt: null,
  });
  const resolveLanguage = input.resolveLanguage
    ?? consentEmailLanguage(tenantId.value, consent.email, deps);
  const queued = await deps.outbox.enqueue({
    id: deps.ids.nextId(), tenantId: tenantId.value, to: consent.email, now,
    payload: {
      kind: 'marketing-consent-confirmation',
      language: await resolveLanguage(),
      wording: consent.wordingSnapshot,
      confirmationUrl: `${input.confirmationBaseUrl}/${tokenValue}`,
    },
  });
  return queued.ok ? ok({ consent, state: 'pending_confirmation' }) : queued;
};

export const recordCheckoutMarketingConsents = async (
  ctx: Ctx,
  input: {
    email: string;
    selectedDefinitionIds: string[];
    attachedDefinitionIds: string[];
    evidence: ConsentEvidence;
    confirmationBaseUrl: string;
  },
  deps: ConsentDeps,
): Promise<Result<{ recorded: number; pendingConfirmations: number }, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'marketing:consent:write');
  if (!tenantId.ok) return tenantId;
  const attached = new Set(input.attachedDefinitionIds);
  const selected = [...new Set(input.selectedDefinitionIds)].filter((definitionId) => attached.has(definitionId));
  const resolveLanguage = consentEmailLanguage(tenantId.value, input.email, deps);
  let recordedCount = 0;
  let pendingConfirmations = 0;
  for (const definitionId of selected) {
    const definition = await deps.definitions.findById(tenantId.value, definitionId);
    if (definition !== null) {
      const rows = await deps.consents.listByEmail(tenantId.value, input.email, definitionId);
      const state = deriveConsentState(rows, definition);
      const pendingStillValid = state.state === 'pending_confirmation'
        && state.row !== null
        && Date.parse(state.row.occurredAt) + confirmationTokenTtlMs > Date.parse(deps.clock.nowIso());
      if (state.active || pendingStillValid) continue;
    }
    const recorded = await recordMarketingConsent(ctx, {
      email: input.email,
      memberId: null,
      definitionId,
      evidence: input.evidence,
      source: 'checkout',
      confirmationBaseUrl: input.confirmationBaseUrl,
      resolveLanguage,
    }, deps);
    if (!recorded.ok) return recorded;
    recordedCount += 1;
    if (recorded.value.state === 'pending_confirmation') pendingConfirmations += 1;
  }
  return ok({ recorded: recordedCount, pendingConfirmations });
};

export const confirmMarketingConsent = async (
  ctx: Ctx,
  input: { token: string; evidence: ConsentEvidence },
  deps: Pick<ConsentDeps, 'confirmations' | 'consents' | 'ids' | 'clock'>,
): Promise<Result<{ consent: MarketingConsent }, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'marketing:consent:write');
  if (!tenantId.ok) return tenantId;
  const token = await deps.confirmations.findByToken(tenantId.value, input.token);
  if (token === null) return err(notFound('Consent confirmation token was not found'));
  const now = deps.clock.nowIso();
  const granted = await deps.consents.findById(tenantId.value, token.marketingConsentRowId);
  if (granted === null) return err(notFound('Pending consent was not found'));
  if (token.usedAt !== null) {
    const confirmed = (await deps.consents.listByEmail(tenantId.value, granted.email, granted.definitionId))
      .find((row) => row.status === 'confirmed' && row.previousId === granted.id);
    return confirmed === undefined
      ? err(validation('Consent confirmation token is expired or already used'))
      : ok({ consent: confirmed });
  }
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
  const tenantId = tenantIdFrom(ctx, 'marketing:consent:write');
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
  const tenantId = tenantIdFrom(ctx, 'marketing:consent:read');
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
  const tenantId = staffTenantIdFrom(ctx, 'marketing:suppression:write');
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
  const tenantId = staffTenantIdFrom(ctx, 'marketing:suppression:write');
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
  events: EmailEventRepository;
  ids: IdGenerator;
  clock: Clock;
}

export const getUnsubscribePreferences = async (
  ctx: Ctx,
  input: { token: string },
  deps: UnsubscribeDeps,
): Promise<Result<{
  email: string;
  scope: string;
  scopeLabel: string | null;
  globallySuppressed: boolean;
  definitions: Array<{ id: string; label: string; active: boolean; pendingConfirmation: boolean }>;
}, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'marketing:consent:read');
  if (!tenantId.ok) return tenantId;
  const token = await deps.unsubscribes.findByToken(tenantId.value, input.token);
  if (token === null) return err(notFound('Unsubscribe token was not found'));
  const definitions = (await deps.definitions.list(tenantId.value, 'active'))
    .filter((definition) => definition.kind === 'optional_marketing');
  const states = await Promise.all(definitions.map(async (definition) => {
    const state = deriveConsentState(
      await deps.consents.listByEmail(tenantId.value, token.email, definition.id),
      definition,
    );
    const version = (await deps.definitions.listVersions(tenantId.value, definition.id)).at(-1);
    return {
      id: definition.id,
      label: version?.label ?? definition.key,
      active: state.active,
      pendingConfirmation: state.state === 'pending_confirmation',
    };
  }));
  const scopeDefinitionId = token.scope === 'all_marketing'
    ? null
    : token.scope.slice('consent:'.length);
  const scopeLabel = scopeDefinitionId === null
    ? null
    : states.find((definition) => definition.id === scopeDefinitionId)?.label ?? null;
  const emailHmac = deps.hmac.compute(tenantId.value, token.email);
  return ok({
    email: token.email,
    scope: token.scope,
    scopeLabel,
    globallySuppressed: await deps.suppressions.isSuppressed(tenantId.value, emailHmac),
    definitions: states,
  });
};

export const saveMarketingConsentPreferences = async (
  ctx: Ctx,
  input: {
    token: string;
    selectedDefinitionIds: string[];
    presentDefinitionIds: string[];
    evidence: ConsentEvidence;
    confirmationBaseUrl: string;
  },
  deps: UnsubscribeDeps & Pick<ConsentDeps, 'confirmations' | 'members' | 'outbox' | 'tenants' | 'tokens'>,
): Promise<Result<{ pendingConfirmations: number }, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'marketing:consent:write');
  if (!tenantId.ok) return tenantId;
  const token = await deps.unsubscribes.findByToken(tenantId.value, input.token);
  if (token === null) return err(notFound('Unsubscribe token was not found'));
  const definitions = (await deps.definitions.list(tenantId.value, 'active'))
    .filter((definition) => definition.kind === 'optional_marketing');
  const allowedIds = new Set(definitions.map((definition) => definition.id));
  if (input.selectedDefinitionIds.some((definitionId) => !allowedIds.has(definitionId))) {
    return err(validation('Invalid marketing consent preference'));
  }
  const selectedIds = new Set(input.selectedDefinitionIds);
  const presentIds = new Set(input.presentDefinitionIds.filter((definitionId) => allowedIds.has(definitionId)));
  const emailHmac = deps.hmac.compute(tenantId.value, token.email);
  if (selectedIds.size > 0 && await deps.suppressions.isSuppressed(tenantId.value, emailHmac)) {
    return err(validation('Globally unsubscribed addresses cannot re-subscribe from this page'));
  }
  const resolveLanguage = consentEmailLanguage(tenantId.value, token.email, deps);
  let pendingConfirmations = 0;
  for (const definition of definitions) {
    const state = deriveConsentState(
      await deps.consents.listByEmail(tenantId.value, token.email, definition.id),
      definition,
    );
    const selected = selectedIds.has(definition.id);
    if (presentIds.has(definition.id) && !selected && state.state !== 'none' && state.state !== 'withdrawn') {
      const withdrawn = await withdrawMarketingConsent(ctx, {
        email: token.email,
        definitionId: definition.id,
        evidence: input.evidence,
      }, deps);
      if (!withdrawn.ok) return withdrawn;
    }
    if (selected && state.state !== 'active' && state.state !== 'pending_confirmation') {
      const recorded = await recordMarketingConsent(ctx, {
        email: token.email,
        memberId: token.memberId,
        definitionId: definition.id,
        evidence: input.evidence,
        source: 'preference_page',
        confirmationBaseUrl: input.confirmationBaseUrl,
        resolveLanguage,
      }, deps);
      if (!recorded.ok) return recorded;
      if (recorded.value.state === 'pending_confirmation') pendingConfirmations += 1;
    } else if (selected && state.state === 'pending_confirmation') {
      pendingConfirmations += 1;
    }
  }
  return ok({ pendingConfirmations });
};

export const unsubscribeOneClick = async (
  ctx: Ctx,
  input: { token: string },
  deps: UnsubscribeDeps,
): Promise<Result<{ unsubscribed: true }, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'marketing:consent:write');
  if (!tenantId.ok) return tenantId;
  const existing = await deps.unsubscribes.findByToken(tenantId.value, input.token);
  if (existing === null) return err(notFound('Unsubscribe token was not found'));
  const event = existing.campaignSendId === null
    ? undefined
    : lifecycleEvent(
        deps,
        tenantId.value,
        'marketing',
        existing.campaignSendId,
        'unsubscribed',
        { scope: existing.scope },
      );
  const consumed = await deps.unsubscribes.consume(
    tenantId.value,
    input.token,
    deps.clock.nowIso(),
    event,
  );
  if (consumed === null) return err(notFound('Unsubscribe token was not found'));
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
    await deps.suppressions.record(
      tenantId.value,
      {
        id: deps.ids.nextId(), tenantId: tenantId.value, email: consumed.token.email, emailHmac,
        reason: 'unsubscribe_global', sourceRef: consumed.token.id, meta: null, createdAt: deps.clock.nowIso(),
        liftedAt: null, liftedBy: null,
      },
      consumed.token.campaignSendId === null
        ? undefined
        : lifecycleEvent(
            deps,
            tenantId.value,
            'marketing',
            consumed.token.campaignSendId,
            'suppressed_written',
            { reason: 'unsubscribe_global' },
          ),
    );
  }
  return ok({ unsubscribed: true });
};

export const unsubscribeAllMarketing = async (
  ctx: Ctx,
  input: { token: string },
  deps: UnsubscribeDeps,
): Promise<Result<{ unsubscribed: true }, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'marketing:consent:write');
  if (!tenantId.ok) return tenantId;
  const existing = await deps.unsubscribes.findByToken(tenantId.value, input.token);
  if (existing === null) return err(notFound('Unsubscribe token was not found'));
  const event = existing.campaignSendId === null
    ? undefined
    : lifecycleEvent(
        deps,
        tenantId.value,
        'marketing',
        existing.campaignSendId,
        'unsubscribed',
        { scope: 'all_marketing' },
      );
  const consumed = await deps.unsubscribes.consume(
    tenantId.value,
    input.token,
    deps.clock.nowIso(),
    event,
  );
  if (consumed === null) return err(notFound('Unsubscribe token was not found'));
  const token = consumed.token;
  const definitions = (await deps.definitions.list(tenantId.value, 'active'))
    .filter((definition) => definition.kind === 'optional_marketing');
  for (const definition of definitions) {
    const latest = await deps.consents.latestByEmail(tenantId.value, token.email, definition.id);
    if (latest === null) continue;
    const withdrawn = await withdrawMarketingConsent(ctx, {
      email: token.email,
      definitionId: definition.id,
      evidence: { collectedAt: deps.clock.nowIso() },
    }, deps);
    if (!withdrawn.ok) return withdrawn;
  }
  const emailHmac = deps.hmac.compute(tenantId.value, token.email);
  await deps.suppressions.record(
    tenantId.value,
    {
      id: deps.ids.nextId(), tenantId: tenantId.value, email: token.email, emailHmac,
      reason: 'unsubscribe_global', sourceRef: token.id, meta: null, createdAt: deps.clock.nowIso(),
      liftedAt: null, liftedBy: null,
    },
    token.campaignSendId === null
      ? undefined
      : lifecycleEvent(
          deps,
          tenantId.value,
          'marketing',
          token.campaignSendId,
          'suppressed_written',
          { reason: 'unsubscribe_global' },
        ),
  );
  return ok({ unsubscribed: true });
};

interface CampaignDeps {
  contactAudienceDeps?: MarketingContactAudienceDeps | undefined;
  campaigns: CampaignRepository;
  audience: MarketingAudienceRepository;
  definitions: ConsentDefinitionRepository;
  layouts?: EmailLayoutRepository;
  ids: IdGenerator;
  clock: Clock;
  scheduler: SchedulerPort;
}

export const createCampaign = async (
  ctx: Ctx,
  input: {
    name: string;
    subject: string;
    bodyHtml: string;
    bodySource?: string | undefined;
    bodyText?: string | null | undefined;
    replyTo?: string | null | undefined;
    consentDefinitionId: string;
    audience?: ContactCampaignAudience | undefined;
    productIds?: string[];
    layoutId?: string | null;
  },
  deps: CampaignDeps,
): Promise<Result<Campaign, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:campaign:write');
  if (!tenantId.ok) return tenantId;
  const definition = await deps.definitions.findById(tenantId.value, input.consentDefinitionId);
  if (definition === null || definition.status !== 'active' || definition.kind !== 'optional_marketing') {
    return err(validation('An active marketing consent definition is required'));
  }
  if (input.layoutId !== undefined && input.layoutId !== null) {
    if (deps.layouts === undefined || await deps.layouts.findById(tenantId.value, input.layoutId) === null) {
      return err(validation('E-mail layout was not found'));
    }
  }
  if (input.audience !== undefined) {
    if (deps.contactAudienceDeps === undefined) return err(validation('Contact audiences are not configured'));
    const prepared = await prepareMarketingContactAudience(tenantId.value, input.audience, deps.contactAudienceDeps);
    if (!prepared.ok) return prepared;
  }
  const now = deps.clock.nowIso();
  const campaign: Campaign = {
    id: deps.ids.nextId(), tenantId: tenantId.value, name: input.name, subject: input.subject,
    bodyText: input.bodyText ?? null, replyTo: input.replyTo ?? null,
    bodyHtml: input.bodyHtml, bodySource: input.bodySource ?? input.bodyHtml, layoutId: input.layoutId ?? null, consentDefinitionId: input.consentDefinitionId,
    audienceVersion: input.audience === undefined ? 1 : 2, audience: input.audience ?? null, audienceSnapshotId: null, snapshotMaxContactId: null, cursorContactId: null, candidateCount: 0, skipped: 0,
    audienceFilter: input.productIds === undefined || input.productIds.length === 0 ? null : { productIds: input.productIds }, status: 'draft', sendAt: null, snapshotMaxMemberId: null, cursorMemberId: null,
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
  const tenantId = staffTenantIdFrom(ctx, 'marketing:campaign:read');
  if (!tenantId.ok) return tenantId;
  const campaign = await deps.campaigns.findById(tenantId.value, input.campaignId);
  return campaign === null ? err(notFound('Campaign was not found')) : ok(campaign);
};

export const listCampaigns = async (
  ctx: Ctx,
  deps: Pick<CampaignDeps, 'campaigns'>,
): Promise<Result<Campaign[], AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:campaign:read');
  if (!tenantId.ok) return tenantId;
  return ok(await deps.campaigns.list(tenantId.value));
};

const emptyEngagementStats = (): CampaignEngagementStats => ({
  uniqueOpens: 0,
  totalOpens: 0,
  uniqueClicks: 0,
  totalClicks: 0,
});

export const getCampaignWithEngagement = async (
  ctx: Ctx,
  input: { campaignId: string },
  deps: { campaigns: CampaignRepository; sends: CampaignSendRepository },
): Promise<Result<Campaign & { engagement: CampaignEngagementStats; queued: number; unresolved: number }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:campaign:read');
  if (!tenantId.ok) return tenantId;
  const campaign = await getCampaign(ctx, input, deps);
  if (!campaign.ok) return campaign;
  const stats = await deps.sends.engagementStats(campaign.value.tenantId, [campaign.value.id]);
  const progress = await deps.sends.progressStats(campaign.value.tenantId, [campaign.value.id]);
  return ok({ ...campaign.value, ...(progress.get(campaign.value.id) ?? { queued: 0, unresolved: 0 }), engagement: stats.get(campaign.value.id) ?? emptyEngagementStats() });
};

export const listCampaignsWithEngagement = async (
  ctx: Ctx,
  deps: { campaigns: CampaignRepository; sends: CampaignSendRepository },
): Promise<Result<Array<Campaign & { engagement: CampaignEngagementStats; queued: number; unresolved: number }>, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:campaign:read');
  if (!tenantId.ok) return tenantId;
  const campaigns = await deps.campaigns.list(tenantId.value);
  const stats = await deps.sends.engagementStats(tenantId.value, campaigns.map((campaign) => campaign.id));
  const progress = await deps.sends.progressStats(tenantId.value, campaigns.map((campaign) => campaign.id));
  return ok(campaigns.map((campaign) => ({
    ...campaign,
    ...(progress.get(campaign.id) ?? { queued: 0, unresolved: 0 }),
    engagement: stats.get(campaign.id) ?? emptyEngagementStats(),
  })));
};

export const deleteCampaign = async (
  ctx: Ctx,
  input: { campaignId: string },
  deps: Pick<CampaignDeps, 'campaigns'>,
): Promise<Result<{ deleted: true }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:campaign:write');
  if (!tenantId.ok) return tenantId;
  const campaign = await deps.campaigns.findById(tenantId.value, input.campaignId);
  if (campaign === null) return err(notFound('Campaign was not found'));
  if (campaign.status !== 'draft') return err(validation('Only draft campaigns can be deleted'));
  return await deps.campaigns.delete(tenantId.value, campaign.id)
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
  const tenantId = staffTenantIdFrom(ctx, 'marketing:campaign:write');
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
  const tenantId = staffTenantIdFrom(ctx, 'marketing:campaign:send');
  if (!tenantId.ok) return tenantId;
  const sendAt = Date.parse(input.sendAt);
  if (!Number.isFinite(sendAt) || new Date(sendAt).toISOString() !== input.sendAt) {
    return err(validation('Campaign schedule requires an ISO timestamp'));
  }
  const campaign = await deps.campaigns.findById(tenantId.value, input.campaignId);
  if (campaign === null) return err(notFound('Campaign was not found'));
  if (campaign.audienceVersion === 2) {
    if (deps.contactAudienceDeps === undefined) return err(validation('Contact audiences are not configured'));
    const scheduled = await scheduleMarketingContactCampaign(ctx, input, { ...deps.contactAudienceDeps, campaigns: deps.campaigns });
    if (!scheduled.ok) return scheduled;
    const queued = await deps.scheduler.scheduleCampaignTick(tenantId.value, campaign.id, input.sendAt);
    return queued.ok ? scheduled : queued;
  }
  const definition = await deps.definitions.findById(tenantId.value, campaign.consentDefinitionId);
  if (definition === null || definition.status !== 'active' || definition.kind !== 'optional_marketing') {
    return err(validation('Campaign requires an active marketing consent definition'));
  }
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
): Promise<Result<Campaign, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:campaign:write');
  if (!tenantId.ok) return tenantId;
  return transitionCampaign(ctx, input.campaignId, input.resume === true ? 'running' : 'paused', deps, {
    pausedReason: input.resume === true ? null : 'Paused by staff', lockedUntil: null, lockedBy: null,
  });
};

export const cancelCampaign = async (
  ctx: Ctx,
  input: { campaignId: string },
  deps: CampaignDeps,
): Promise<Result<Campaign, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:campaign:write');
  if (!tenantId.ok) return tenantId;
  return transitionCampaign(ctx, input.campaignId, 'cancelled', deps);
};

export interface SendDeps extends EligibilityDeps {
  contacts?: MarketingContactRepository | undefined;
  tenants: Pick<TenantRepository, 'findSettings'>;
  htmlToText: HtmlToText;
  delivery: MarketingDeliveryTransaction;
  marketingOutbox: MarketingOutboxRepository;
  waiter: MarketingWaiter;
  batchCap?: number;
  layouts: EmailLayoutRepository;
  sends: CampaignSendRepository;
  events: EmailEventRepository;
  unsubscribes: UnsubscribeTokenRepository;
  sesSettings: TenantSesSettingsRepository;
  ses: SesMarketingSender;
  credentials: MarketingSesCredentialResolver;
  quotaReader: SesMarketingQuotaReader | undefined;
  throttle: MarketingThrottleRepository;
  ids: IdGenerator;
  tokens: TokenGenerator;
  clock: Clock;
  unsubscribeBaseUrl(tenantId: string): Promise<string>;
  runId?: string;
}

const lifecycleEvent = (
  deps: { ids: IdGenerator; clock: Clock; runId?: string },
  tenantId: string,
  mailKind: 'transactional' | 'marketing',
  refId: string,
  type: EmailEvent['type'],
  meta: Record<string, unknown> | null,
  occurredAt = deps.clock.nowIso(),
): EmailEvent => emailEventSchema.parse({
  id: deps.ids.nextId(),
  tenantId,
  mailKind,
  refId,
  type,
  occurredAt,
  meta: deps.runId === undefined ? meta : { ...(meta ?? {}), runId: deps.runId },
  createdAt: deps.clock.nowIso(),
});

export interface MarketingMessageInput {
  contactId?: string;
  audienceSnapshotId?: string;
  snapshotSkipReason?: MarketingIneligibilityReason | null;
  to: string;
  memberId: string | null;
  campaignId: string | null;
  source: CampaignSend['source'];
  consentDefinitionId: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string | null | undefined;
  replyTo?: string | null | undefined;
  layoutId?: string | null;
  data: Record<string, unknown>;
  idempotencySource?: string;
}

export type MarketingSendResult =
  | { to: string; sendId: string; status: 'sent' | 'queued' }
  | { to: string; sendId: string | null; status: 'skipped'; reason: MarketingIneligibilityReason }
  | { to: string; sendId: string; status: 'failed'; error: AppError }
  | { to: string; sendId: null; status: 'deduplicated' };

const recordValue = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

const consentFooterReference = (definition: { footerLabel?: string | null | undefined }, wording: string): string => {
  const footerLabel = definition.footerLabel?.trim();
  return footerLabel === undefined || footerLabel === '' ? wording : footerLabel;
};

const eligibilityFor = async (tenantId: string, input: MarketingMessageInput, deps: SendDeps) => {
  const definition = await deps.definitions.findById(tenantId, input.consentDefinitionId);
  if (definition === null) return null;
  const rows = await deps.consents.listByEmail(tenantId, input.to, definition.id);
  const consent = deriveConsentState(rows, definition);
  const suppressed = await deps.suppressions.isSuppressed(tenantId, deps.hmac.compute(tenantId, normalizeEmail(input.to)));
  return { definition, eligibility: deriveMarketingEligibility({ consent, suppressed }), latest: consent.row };
};

/**
 * Every marketing send resolves credentials before it reaches SES, so refusing
 * them here is the one place that covers campaign dispatch, the M2M send API and
 * the send-to-self test alike.
 */
export const createSmokeTenantSilencedCredentials = (
  resolver: MarketingSesCredentialResolver,
): MarketingSesCredentialResolver => ({
  resolve: async (tenantId) => isSmokeTenant(tenantId)
    ? err(appError('broadcasts_disabled', 'The smoke tenant is excluded from marketing sends'))
    : resolver.resolve(tenantId),
});

const enqueueMarketingMessagesExecution = async (
  ctx: Ctx,
  inputs: MarketingMessageInput[],
  deps: SendDeps,
): Promise<Result<MarketingSendResult[], AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'marketing:message:send');
  if (!tenantId.ok) return tenantId;
  const settings = await deps.sesSettings.findByTenant(tenantId.value);
  if (settings === null) return err(appError('ses_not_configured', 'Tenant SES is not configured'));
  if (settings.trackingEnabled && settings.configurationSet === null) {
    return err(validation('Open and click tracking requires an SES configuration set'));
  }
  const credentials = await deps.credentials.resolve(tenantId.value);
  if (!credentials.ok) return credentials;
  if (!tenantSesBroadcastsReady(settings)) return err(appError('broadcasts_disabled', 'Marketing broadcasts are disabled'));
  const unsubscribeBaseUrl = await deps.unsubscribeBaseUrl(tenantId.value);
  const footerCopy = marketingFooterCopy((await deps.tenants.findSettings(tenantId.value))?.defaultLanguage);
  const results: MarketingSendResult[] = [];
  for (const input of inputs) {
    const initial = await eligibilityFor(tenantId.value, input, deps);
    if (initial === null) return err(notFound('Consent definition was not found'));
    if (input.snapshotSkipReason) initial.eligibility = { eligible: false, reason: input.snapshotSkipReason };
    if (!initial.eligibility.eligible) {
      const skippedId = deps.ids.nextId();
      const skipped: CampaignSend = {
        id: skippedId, runId: deps.runId ?? null, tenantId: tenantId.value, campaignId: input.campaignId, source: input.source,
        contactId: input.contactId ?? null, audienceSnapshotId: input.audienceSnapshotId ?? null,
        memberId: input.memberId, email: normalizeEmail(input.to), subject: input.subject,
        consentRowId: initial.latest?.id ?? null,
        unsubscribeTokenId: null, status: 'skipped', skipReason: initial.eligibility.reason,
        sesMessageId: null, deliveryStatus: null, deliveryOccurredAt: null,
        idempotencySource: input.idempotencySource ?? null, renderedBodyPurgedAt: null,
        createdAt: deps.clock.nowIso(), sentAt: null,
      };
      const claimed = await deps.sends.claimRecipient(tenantId.value, skipped, [
        lifecycleEvent(
          deps,
          tenantId.value,
          'marketing',
          skipped.id,
          'skipped',
          { reason: initial.eligibility.reason },
        ),
      ]);
      if (!claimed) { results.push({ to: skipped.email, sendId: null, status: 'deduplicated' }); continue; }
      results.push({ to: normalizeEmail(input.to), sendId: skippedId, status: 'skipped', reason: initial.eligibility.reason });
      continue;
    }
    const sendId = deps.ids.nextId();
    const send: CampaignSend = {
      id: sendId, runId: deps.runId ?? null, tenantId: tenantId.value, campaignId: input.campaignId, source: input.source,
      contactId: input.contactId ?? null, audienceSnapshotId: input.audienceSnapshotId ?? null,
      memberId: input.memberId, email: normalizeEmail(input.to), subject: input.subject,
      consentRowId: initial.eligibility.consentRow.id,
      unsubscribeTokenId: null, status: 'pending', skipReason: null, sesMessageId: null,
      deliveryStatus: null, deliveryOccurredAt: null, idempotencySource: input.idempotencySource ?? null,
      renderedBodyPurgedAt: null, createdAt: deps.clock.nowIso(), sentAt: null,
    };
    if (!await deps.sends.claimRecipient(tenantId.value, send, [
      lifecycleEvent(deps, tenantId.value, 'marketing', send.id, 'queued', null),
      lifecycleEvent(deps, tenantId.value, 'marketing', send.id, 'claimed', null),
    ])) {
      results.push({ to: send.email, sendId: null, status: 'deduplicated' });
      continue;
    }
    const dequeue = await eligibilityFor(tenantId.value, input, deps);
    if (dequeue === null) {
      await deps.sends.update(
        tenantId.value,
        { ...send, status: 'skipped', skipReason: 'not_consented' },
        [lifecycleEvent(deps, tenantId.value, 'marketing', send.id, 'skipped', { reason: 'not_consented' })],
      );
      results.push({ to: send.email, sendId, status: 'skipped', reason: 'not_consented' });
      continue;
    }
    if (!dequeue.eligibility.eligible) {
      const reason = dequeue.eligibility.reason;
      await deps.sends.update(
        tenantId.value,
        { ...send, status: 'skipped', skipReason: reason },
        [lifecycleEvent(deps, tenantId.value, 'marketing', send.id, 'skipped', { reason })],
      );
      results.push({ to: send.email, sendId, status: 'skipped', reason });
      continue;
    }
    const unsubscribeTokenId = deps.ids.nextId();
    const token = deps.tokens.nextToken();
    const unsubscribeUrl = `${unsubscribeBaseUrl}/${token}`;
    await deps.unsubscribes.create(tenantId.value, {
      id: unsubscribeTokenId, tenantId: tenantId.value, token, email: send.email, memberId: input.memberId,
      campaignSendId: sendId, scope: `consent:${input.consentDefinitionId}`, createdAt: deps.clock.nowIso(), usedAt: null,
    });
    const layout = input.layoutId === undefined || input.layoutId === null
      ? null
      : await deps.layouts.findById(tenantId.value, input.layoutId);
    if (input.layoutId !== undefined && input.layoutId !== null && layout === null) {
      await deps.sends.update(
        tenantId.value,
        { ...send, unsubscribeTokenId, status: 'failed' },
        [lifecycleEvent(
          deps,
          tenantId.value,
          'marketing',
          send.id,
          'failed',
          { error: 'Marketing e-mail layout was not found' },
        )],
      );
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
      bodyText: input.bodyText,
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
      unsubscribeLabel: footerCopy.unsubscribe,
      legalName: settings.footerLegalName,
      address: settings.footerAddress,
      consentReference: consentFooterReference(dequeue.definition, dequeue.eligibility.consentRow.wordingSnapshot),
      consentBasisPrefix: footerCopy.basisPrefix,
      consentBasisSuffix: footerCopy.basisSuffix,
      layoutHtml: layout?.bodyHtml ?? null,
    }, deps);
    if (!rendered.ok) {
      await deps.sends.update(
        tenantId.value,
        { ...send, unsubscribeTokenId, status: 'failed' },
        [lifecycleEvent(
          deps,
          tenantId.value,
          'marketing',
          send.id,
          'failed',
          { error: rendered.error.message },
        )],
      );
      results.push({ to: send.email, sendId, status: 'failed', error: rendered.error });
      continue;
    }
    await deps.sends.update(tenantId.value, { ...send, unsubscribeTokenId, subject: rendered.value.subject }, [
      lifecycleEvent(deps, tenantId.value, 'marketing', send.id, 'rendered', null),
    ]);
    const queuedAt = deps.clock.nowIso();
    await deps.marketingOutbox.enqueue(tenantId.value, {
      id: deps.ids.nextId(), tenantId: tenantId.value, campaignSendId: send.id,
      payload: { campaignSendId: send.id, consentDefinitionId: input.consentDefinitionId,
        to: send.email, ...rendered.value,
        from: { address: settings.fromAddress, name: settings.fromName },
        replyTo: input.replyTo ?? settings.replyTo ?? settings.fromAddress, configurationSet: settings.configurationSet,
      },
      payloadPurgedAt: null, status: 'pending', attempts: 0, nextAttemptAt: queuedAt,
      lockedBy: null, lockedUntil: null, claimVersion: 0, sesMessageId: null, lastError: null,
      createdAt: queuedAt, updatedAt: queuedAt,
    });
    results.push({ to: send.email, sendId, status: 'queued' });
  }
  return ok(results);
};

export const sendMarketingMessages = async (
  ctx: Ctx,
  inputs: MarketingMessageInput[],
  deps: SendDeps,
): Promise<Result<MarketingSendResult[], AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'marketing:message:send');
  if (!tenantId.ok) return tenantId;
  if (deps.quotaReader !== undefined) {
    const settings = await deps.sesSettings.findByTenant(tenantId.value);
    if (settings === null) return err(appError('ses_not_configured', 'Tenant SES is not configured'));
    const credentials = await deps.credentials.resolve(tenantId.value);
    if (!credentials.ok) return credentials;
    const now = deps.clock.nowIso();
    if (settings.quotaRefreshedAt === null
      || Date.parse(now) - Date.parse(settings.quotaRefreshedAt) >= 15 * 60 * 1000) {
      const quota = await deps.quotaReader.read(credentials.value);
      if (!quota.ok) return quota;
      await deps.sesSettings.upsert(tenantId.value, {
        ...settings,
        quotaRatePerSec: quota.value.ratePerSecond,
        quotaDaily: quota.value.daily,
        quotaSentLast24Hours: quota.value.sentLast24Hours,
        quotaRefreshedAt: now,
        inSandbox: quota.value.inSandbox,
      });
    }
  }
  return deps.delivery.run(tenantId.value, (repos) => enqueueMarketingMessagesExecution(ctx, inputs, { ...deps, ...repos }));
};

interface TickDeps extends SendDeps {
  contactAudience?: MarketingContactAudienceRepository | undefined;
  snsInbox: MarketingSnsInboxRepository;
  campaigns: CampaignRepository;
  audience: MarketingAudienceRepository;
  outbox: EmailOutboxRepository;
  scheduler: SchedulerPort;
  runs: SchedulerRunRepository;
  /** Set on production only: the synthetic tenant never reaches a real audience. */
  silenceSmokeTenant?: boolean;
}

interface CampaignTickMetrics {
  campaignsTouched: number;
  batchSize: number;
  sent: number;
  failed: number;
  skipped: number;
  budgetComputed: number;
  budgetUsed: number;
  reEnqueued: boolean;
  errors: string[];
}

const campaignTickExecution = async (
  ctx: Ctx,
  input: { campaignId: string; workerId: string; tickSeconds: number; errorThreshold?: number; trigger?: 'cron' | 'dev' | 'manual' },
  deps: TickDeps,
  metrics: CampaignTickMetrics,
): Promise<Result<{ leased: boolean; yieldedToTransactional: boolean; sent: number; failed: number; skipped: number }, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'marketing:campaign:dispatch');
  if (!tenantId.ok) return tenantId;
  let campaign = await deps.campaigns.findById(tenantId.value, input.campaignId);
  if (campaign === null) return err(notFound('Campaign was not found'));
  metrics.campaignsTouched = 1;
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
  const scheduleNextTick = async () => {
    const scheduled = await deps.scheduler.scheduleCampaignTick(
      tenantId.value,
      campaign.id,
      new Date(Date.parse(now) + input.tickSeconds * 1000).toISOString(),
    );
    if (scheduled.ok) metrics.reEnqueued = true;
    return scheduled;
  };
  const settings = await deps.sesSettings.findByTenant(tenantId.value);
  if (settings === null) return err(appError('ses_not_configured', 'Tenant SES is not configured'));
  if (settings.autoPauseOnCritical) {
    const reputation = deriveEmailReputation(await deps.events.reputationCounts(
      tenantId.value,
      reputationWindow(now),
    ));
    if (reputation.overallStatus === 'critical') {
      await deps.campaigns.update(tenantId.value, {
        ...campaign,
        status: 'paused',
        pausedReason: 'Broadcasts paused automatically: critical email reputation threshold exceeded',
        lockedUntil: null,
        lockedBy: null,
      });
      return ok({ leased: true, yieldedToTransactional: false, sent: 0, failed: 0, skipped: 0 });
    }
  }
  const transactionalPending = await deps.outbox.hasPendingForTenant?.(tenantId.value) ?? false;
  const budget = marketingSendBudget({ ratePerSecond: settings.quotaRatePerSec * (transactionalPending ? 0.5 : 1), sendSeconds: input.tickSeconds,
    dailyRemaining: settings.quotaDaily - settings.quotaSentLast24Hours, batchCap: deps.batchCap ?? 1000 });
  metrics.budgetComputed = budget;
  const contactMode = campaign.audienceVersion === 2;
  if (contactMode && (deps.contactAudience === undefined || campaign.audienceSnapshotId === null)) return err(validation('Contact audience snapshot is missing'));
  const maxMemberId = contactMode ? campaign.snapshotMaxContactId : campaign.snapshotMaxMemberId;
  if (maxMemberId === null && campaign.toSend === 0) {
    await deps.campaigns.update(tenantId.value, { ...campaign, status: 'finished', finishedAt: now });
    return ok({ leased: true, yieldedToTransactional: false, sent: 0, failed: 0, skipped: 0 });
  }
  if (budget === 0 || maxMemberId === null) {
    const scheduled = await scheduleNextTick();
    return scheduled.ok
      ? ok({ leased: true, yieldedToTransactional: false, sent: 0, failed: 0, skipped: 0 })
      : scheduled;
  }
  const members = contactMode && deps.contactAudience !== undefined && campaign.audienceSnapshotId !== null
    ? (await deps.contactAudience.fetchSnapshotPage(tenantId.value, { snapshotId: campaign.audienceSnapshotId, afterContactId: campaign.cursorContactId, maxContactId: maxMemberId, limit: budget })).map((row) => ({
      cursor: row.contactId, memberId: row.memberIdSnapshot, email: row.email, displayName: row.displayNameSnapshot,
      firstName: row.firstNameSnapshot, contactId: row.contactId, audienceSnapshotId: row.snapshotId, snapshotSkipReason: row.skipReason,
    }))
    : (await deps.audience.fetchEligibleBatch(tenantId.value, {
      definitionId: campaign.consentDefinitionId, productIds: campaign.audienceFilter?.productIds ?? [],
      afterMemberId: campaign.cursorMemberId, maxMemberId, limit: budget,
    })).map((row) => ({ ...row, cursor: row.memberId, firstName: null, contactId: undefined, audienceSnapshotId: undefined, snapshotSkipReason: null }));
  metrics.batchSize = members.length;
  metrics.budgetUsed = members.length;
  let lastCursor = contactMode ? campaign.cursorContactId : campaign.cursorMemberId;
  const unsubscribeBaseUrl = await deps.unsubscribeBaseUrl(tenantId.value);
  const deadlineAt = new Date(Date.parse(now) + input.tickSeconds * 1000).toISOString();
  for (const member of members) {
    if (Date.parse(deps.clock.nowIso()) + 100 >= Date.parse(deadlineAt)) break;
    const outcome = await deps.delivery.run(tenantId.value, async (repos) => {
      const result = await enqueueMarketingMessagesExecution(ctx, [{
        ...(member.contactId === undefined ? {} : { contactId: member.contactId }),
        ...(member.audienceSnapshotId === undefined ? {} : { audienceSnapshotId: member.audienceSnapshotId }),
        snapshotSkipReason: member.snapshotSkipReason,
        to: member.email, memberId: member.memberId, campaignId: campaign.id, source: 'broadcast',
        consentDefinitionId: campaign.consentDefinitionId, subject: campaign.subject,
        bodyHtml: campaign.bodyHtml, bodyText: campaign.bodyText, replyTo: campaign.replyTo, layoutId: campaign.layoutId,
        data: { member: { email: member.email, name: member.displayName, firstName: member.firstName }, contact: { email: member.email, name: member.displayName, firstName: member.firstName } },
      }], { ...deps, ...repos, unsubscribeBaseUrl: async () => unsubscribeBaseUrl });
      if (!result.ok) return result;
      const advanced = await repos.campaigns.advanceCursor(tenantId.value, campaign.id, { ...(contactMode ? { cursorContactId: member.cursor } : { cursorMemberId: member.cursor }), skippedDelta: result.value.filter((item) => item.status === 'skipped').length, sentDelta: 0, failedDelta: result.value.filter((item) => item.status === 'failed').length, lease: { workerId: input.workerId, now: deps.clock.nowIso() } });
      if (advanced === null) return err(appError('conflict', 'Campaign enumeration lease was replaced or the campaign stopped'));
      return result;
    });
    if (!outcome.ok) return outcome;
    metrics.skipped += outcome.value.filter((item) => item.status === 'skipped').length;
    lastCursor = member.cursor;
  }
  const dispatched = await dispatchMarketingOutbox(ctx, { workerId: input.workerId, deadlineAt, maxSends: budget, ...(input.errorThreshold === undefined ? {} : { errorThreshold: input.errorThreshold }) }, {
    ...deps,
  });
  if (!dispatched.ok) return dispatched;
  metrics.sent = dispatched.value.sent;
  metrics.failed = dispatched.value.failed;
  metrics.skipped += dispatched.value.skipped;
  const current = await deps.campaigns.findById(tenantId.value, campaign.id);
  const reachedEnd = (members.length < budget && lastCursor === members.at(-1)?.cursor) || members.length === 0 || lastCursor === maxMemberId;
  if (current?.status === 'running') {
    if (reachedEnd && !await deps.sends.hasPendingByCampaign(tenantId.value, campaign.id)) {
      await deps.campaigns.update(tenantId.value, { ...current, status: 'finished', finishedAt: deps.clock.nowIso(), lockedBy: null, lockedUntil: null });
    } else {
      await deps.campaigns.update(tenantId.value, { ...current, lockedBy: null, lockedUntil: deps.clock.nowIso() });
      const scheduled = await scheduleNextTick();
      if (!scheduled.ok) return scheduled;
    }
  }
  return ok({ leased: true, yieldedToTransactional: transactionalPending, sent: metrics.sent, failed: metrics.failed, skipped: metrics.skipped });
};

export const campaignTick = async (
  ctx: Ctx,
  input: { campaignId: string; workerId: string; tickSeconds: number; errorThreshold?: number; trigger?: 'cron' | 'dev' | 'manual' },
  deps: TickDeps,
): Promise<Result<{ leased: boolean; yieldedToTransactional: boolean; sent: number; failed: number; skipped: number }, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'marketing:campaign:dispatch');
  if (!tenantId.ok) return tenantId;
  if (deps.silenceSmokeTenant === true && isSmokeTenant(tenantId.value)) {
    return ok({ leased: false, yieldedToTransactional: false, sent: 0, failed: 0, skipped: 0 });
  }
  const startedAt = deps.clock.nowIso();
  const runId = deps.ids.nextId();
  const emptyTotals = {
    campaignsTouched: 0,
    sendsAttempted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    reEnqueued: false,
  };
  await deps.runs.start({
    id: runId,
    kind: 'marketing_tick',
    trigger: input.trigger ?? 'manual',
    startedAt,
    finishedAt: null,
    durationMs: null,
    status: 'running',
    idle: false,
    error: null,
    totals: emptyTotals,
    createdAt: startedAt,
  });
  const metrics: CampaignTickMetrics = {
    campaignsTouched: 0,
    batchSize: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    budgetComputed: 0,
    budgetUsed: 0,
    reEnqueued: false,
    errors: [],
  };
  let result: Awaited<ReturnType<typeof campaignTickExecution>> | undefined;
  let thrown: unknown;
  try {
    result = await campaignTickExecution(ctx, input, { ...deps, runId }, metrics);
  } catch (cause) {
    thrown = cause;
  } finally {
    const finishedAt = deps.clock.nowIso();
    const resultError = result !== undefined && !result.ok ? result.error.message : null;
    const thrownError = thrown instanceof Error ? thrown.message : thrown === undefined ? null : String(thrown);
    const error = thrownError ?? resultError;
    const totals = {
      campaignsTouched: metrics.campaignsTouched,
      sendsAttempted: metrics.sent + metrics.failed + metrics.skipped,
      sent: metrics.sent,
      failed: metrics.failed,
      skipped: metrics.skipped,
      reEnqueued: metrics.reEnqueued,
    };
    await deps.runs.finalize(runId, {
      finishedAt,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
      status: error === null ? 'completed' : 'failed',
      idle: metrics.batchSize === 0
        && metrics.sent === 0
        && metrics.failed === 0
        && metrics.skipped === 0
        && metrics.errors.length === 0
        && error === null,
      error,
      totals,
      tenants: [{
        id: deps.ids.nextId(),
        runId,
        tenantId: tenantId.value,
        campaignsTouched: metrics.campaignsTouched,
        batchSize: metrics.batchSize,
        sent: metrics.sent,
        failed: metrics.failed,
        skipped: metrics.skipped,
        budgetComputed: metrics.budgetComputed,
        budgetUsed: metrics.budgetUsed,
        errors: error === null ? metrics.errors : [...metrics.errors, error],
        createdAt: finishedAt,
      }],
    });
  }
  if (thrown !== undefined) throw thrown;
  if (result === undefined) throw new Error('Campaign tick did not produce a result');
  return result;
};

export const testSendCampaignToSelf = async (
  ctx: Ctx,
  input: { campaignId: string },
  deps: TickDeps,
): Promise<Result<{ messageId: string }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:campaign:send');
  if (!tenantId.ok) return tenantId;
  const campaign = await deps.campaigns.findById(tenantId.value, input.campaignId);
  const settings = await deps.sesSettings.findByTenant(tenantId.value);
  if (campaign === null) return err(notFound('Campaign was not found'));
  if (settings === null) return err(appError('ses_not_configured', 'Tenant SES is not configured'));
  const tenantSettings = await deps.tenants.findSettings(tenantId.value);
  const footerCopy = marketingFooterCopy(tenantSettings?.defaultLanguage);
  const credentials = await deps.credentials.resolve(tenantId.value);
  if (!credentials.ok) return credentials;
  if (!tenantSesBroadcastsReady(settings)) return err(appError('broadcasts_disabled', 'Marketing broadcasts are disabled'));
  const definition = await deps.definitions.findById(tenantId.value, campaign.consentDefinitionId);
  if (definition === null) return err(notFound('Consent definition was not found'));
  const versions = await deps.definitions.listVersions(tenantId.value, campaign.consentDefinitionId);
  const wording = campaign.consentLabelSnapshot ?? versions.at(-1)?.label;
  if (wording === undefined) return err(validation('Consent definition has no wording version'));
  const consentReference = consentFooterReference(definition, wording);
  const layout = campaign.layoutId === null ? null : await deps.layouts.findById(tenantId.value, campaign.layoutId);
  if (campaign.layoutId !== null && layout === null) return err(notFound('Marketing e-mail layout was not found'));
  const unsubscribeTokenId = deps.ids.nextId();
  const token = deps.tokens.nextToken();
  const unsubscribeUrl = `${await deps.unsubscribeBaseUrl(tenantId.value)}/${token}`;
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
    bodyText: campaign.bodyText,
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
    unsubscribeLabel: footerCopy.unsubscribe,
    legalName: settings.footerLegalName,
    address: settings.footerAddress,
    consentReference,
    consentBasisPrefix: footerCopy.basisPrefix,
    consentBasisSuffix: footerCopy.basisSuffix,
    layoutHtml: layout?.bodyHtml ?? null,
  }, deps);
  if (!rendered.ok) return rendered;
  return deps.ses.send({
    credentials: credentials.value, from: { address: settings.fromAddress, name: settings.fromName }, to: ctx.identity.email,
    subject: `[TEST] ${rendered.value.subject}`, html: rendered.value.html, text: rendered.value.text,
    headers: rendered.value.headers,
    configurationSet: null,
    replyTo: campaign.replyTo ?? settings.replyTo ?? settings.fromAddress,
  });
};

export const claimIdempotencyKey = async (
  ctx: Ctx,
  input: { key: string; method: string; path: string; requestHash: string; ttlSeconds: number },
  deps: { repository: AutomationIdempotencyRepository; ids: IdGenerator; clock: Clock },
): Promise<Result<{ claimed: true }, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'marketing:message:read');
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
  const tenantId = tenantIdFrom(ctx, 'marketing:message:read');
  if (!tenantId.ok) return tenantId;
  if (input.status >= 400 && input.status < 500) await deps.repository.release(tenantId.value, input.key);
  return ok(undefined);
};

export const applyVerifiedSesEvent = async (
  ctx: Ctx,
  event: VerifiedSesEvent,
  deps: Pick<SendDeps, 'sesSettings' | 'sends' | 'events' | 'suppressions' | 'hmac' | 'ids' | 'clock'>
    & { outbox: EmailOutboxRepository; marketingOutbox: MarketingOutboxRepository },
): Promise<Result<SesEventApplication, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'webhook:process');
  if (!tenantId.ok) return tenantId;
  const settings = await deps.sesSettings.findByTenant(tenantId.value);
  if (settings === null || settings.snsTopicArn !== event.topicArn) return err(forbidden('SNS topic does not match this tenant'));
  let send = await deps.sends.correlateBySesMessageId(tenantId.value, event.messageId);
  if (send === null && event.campaignSendId !== undefined) send = await deps.sends.findById(tenantId.value, event.campaignSendId);
  if (send !== null && event.recipient !== undefined && normalizeEmail(event.recipient) !== send.email) return ok({ kind: 'ignored', reason: 'Recipient does not match the correlated send' });
  if (send !== null && send.status !== 'sent') {
    send = { ...send, status: 'sent', sesMessageId: event.messageId, sentAt: event.occurredAt };
    await deps.marketingOutbox.reconcile(tenantId.value, send, lifecycleEvent(deps, tenantId.value, 'marketing', send.id, 'accepted', { sesMessageId: event.messageId }, event.occurredAt));
  }
    if (send === null) {
      if (event.kind === 'open' || event.kind === 'click') return ok({ kind: 'awaiting_correlation' });
      if (deps.outbox.correlateBySesMessageId === undefined || deps.outbox.markDelivery === undefined) {
        return ok({ kind: 'awaiting_correlation' });
      }
      const outbox = await deps.outbox.correlateBySesMessageId(tenantId.value, event.messageId);
      if (outbox === null) return ok({ kind: 'awaiting_correlation' });
      if (event.recipient !== undefined && normalizeEmail(event.recipient) !== normalizeEmail(outbox.to)) return ok({ kind: 'ignored', reason: 'Recipient does not match the transactional send' });
      const classification = event.kind === 'delivery'
        ? null
        : classifySesEvent(event);
      if (classification === 'unresolved') {
        await deps.events.append(
          tenantId.value,
          lifecycleEvent(
            deps,
            tenantId.value,
            'transactional',
            outbox.id,
            'bounced',
            { classification, rawProviderPayload: event.raw },
            event.occurredAt,
          ),
        );
        return ok({ kind: 'applied' });
      }
      const status = event.kind === 'delivery'
        ? 'delivered'
        : event.kind === 'complaint'
          ? 'complained'
          : 'bounced';
      const meta = status === 'bounced'
        ? { classification: classification ?? 'hard', rawProviderPayload: event.raw }
        : { rawProviderPayload: event.raw };
      const marked = await deps.outbox.markDelivery({
        tenantId: tenantId.value,
        id: outbox.id,
        status,
        occurredAt: event.occurredAt,
        event: lifecycleEvent(
          deps,
          tenantId.value,
          'transactional',
          outbox.id,
          status,
          meta,
          event.occurredAt,
        ),
      });
      if (!marked.ok) return marked;
      if (classification !== null && bounceAction(classification).suppress) {
        const reason =
          classification === 'complaint' ? 'complaint' : 'hard_bounce';
        await deps.suppressions.record(
          tenantId.value,
          {
            id: deps.ids.nextId(),
            tenantId: tenantId.value,
            email: outbox.to,
            emailHmac: deps.hmac.compute(tenantId.value, outbox.to),
            reason,
            sourceRef: outbox.id,
            meta: event.raw,
            createdAt: deps.clock.nowIso(),
            liftedAt: null,
            liftedBy: null,
          },
          lifecycleEvent(
            deps,
            tenantId.value,
            'transactional',
            outbox.id,
            'suppressed_written',
            { reason },
            event.occurredAt,
          ),
        );
      }
      return ok({ kind: 'applied' });
    }
    if (event.kind === 'open' || event.kind === 'click') {
      if (!settings.trackingEnabled) return ok({ kind: 'ignored', reason: 'Engagement tracking is disabled' });
      await deps.events.append(
        tenantId.value,
        lifecycleEvent(
          deps,
          tenantId.value,
          'marketing',
          send.id,
          event.kind === 'open' ? 'opened' : 'clicked',
          event.kind === 'open'
            ? { rawProviderPayload: event.raw }
            : { linkUrl: event.linkUrl, rawProviderPayload: event.raw },
          event.occurredAt,
        ),
      );
      return ok({ kind: 'applied' });
    }
    if (event.kind === 'delivery') {
      await deps.sends.update(
        tenantId.value,
        { ...send, ...(send.deliveryStatus === 'bounced' || send.deliveryStatus === 'complained' ? {} : { deliveryStatus: 'delivered' as const, deliveryOccurredAt: event.occurredAt }) },
        [lifecycleEvent(
          deps,
          tenantId.value,
          'marketing',
          send.id,
          'delivered',
          { rawProviderPayload: event.raw },
          event.occurredAt,
        )],
      );
      return ok({ kind: 'applied' });
    }
    const classification = classifySesEvent(event);
    const deliveryStatus = classification === 'complaint' ? 'complained' : 'bounced';
    await deps.sends.update(
      tenantId.value,
      {
        ...send,
        ...(classification === 'unresolved' || send.deliveryStatus === 'complained'
          ? {}
          : { deliveryStatus, deliveryOccurredAt: event.occurredAt }),
      },
      [lifecycleEvent(
        deps,
        tenantId.value,
        'marketing',
        send.id,
        deliveryStatus,
        deliveryStatus === 'bounced'
          ? { classification, rawProviderPayload: event.raw }
          : { rawProviderPayload: event.raw },
        event.occurredAt,
      )],
    );
    if (bounceAction(classification).suppress) {
      await deps.suppressions.record(
        tenantId.value,
        {
          id: deps.ids.nextId(),
          tenantId: tenantId.value,
          email: send.email,
          emailHmac: deps.hmac.compute(tenantId.value, send.email),
          reason: classification === 'complaint' ? 'complaint' : 'hard_bounce',
          sourceRef: send.id,
          meta: event.raw,
          createdAt: deps.clock.nowIso(),
          liftedAt: null,
          liftedBy: null,
        },
        lifecycleEvent(
          deps,
          tenantId.value,
          'marketing',
          send.id,
          'suppressed_written',
          { reason: classification === 'complaint' ? 'complaint' : 'hard_bounce' },
          event.occurredAt,
        ),
      );
    }
    return ok({ kind: 'applied' });
};

export const runMarketingRetentionJobs = async (
  ctx: Ctx,
  input: {
    pendingOlderThan: string;
    renderedBodiesOlderThan: string;
    engagementOlderThan: string;
    rawSnsInboxOlderThan: string;
    idempotencyNow: string;
  },
  deps: Pick<ConsentDeps, 'consents' | 'definitions' | 'clock'> & {
    sends: CampaignSendRepository;
    events: EmailEventRepository;
    idempotency: AutomationIdempotencyRepository;
    marketingOutbox?: MarketingDeliveryRepos['marketingOutbox'];
    snsInbox?: MarketingDeliveryRepos['snsInbox'];
  },
): Promise<Result<{
  pendingConsentsPurged: number;
  renderedBodiesPurged: number;
  engagementEventsPurged: number;
  idempotencyKeysPurged: number;
}, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'scheduler:dispatch');
  if (!tenantId.ok) return tenantId;
  const definitions = await deps.definitions.list(tenantId.value);
  const doubleOptInDefinitionIds = definitions.filter((definition) => definition.doubleOptIn).map((definition) => definition.id);
  const pendingConsentsPurged = await deps.consents.purgeStalePending(tenantId.value, input.pendingOlderThan, doubleOptInDefinitionIds);
  const renderedBodiesPurged = await deps.sends.ageOutRenderedBodies(tenantId.value, input.renderedBodiesOlderThan, deps.clock.nowIso());
  await deps.marketingOutbox?.purge(tenantId.value, input.renderedBodiesOlderThan, deps.clock.nowIso());
  await deps.snsInbox?.purge(tenantId.value, input.rawSnsInboxOlderThan);
  const engagementEventsPurged = await deps.events.purgeEngagement(tenantId.value, input.engagementOlderThan);
  const idempotencyKeysPurged = await deps.idempotency.sweepExpired(input.idempotencyNow);
  return ok({ pendingConsentsPurged, renderedBodiesPurged, engagementEventsPurged, idempotencyKeysPurged });
};

export const scheduleMarketingRetentionJobs = async (
  ctx: Ctx,
  deps: { scheduler: SchedulerPort },
): Promise<Result<void, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'scheduler:dispatch');
  if (!tenantId.ok) return tenantId;
  return deps.scheduler.enqueueRetentionJobs(tenantId.value);
};

export const SES_IDENTITY_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const SCHEDULER_RUN_PURGE_BATCH_SIZE = 500;
const SCHEDULER_RUN_PURGE_TIME_BUDGET_MS = 5_000;
const SCHEDULER_RUN_PURGE_MIN_BATCH_MS = 1_500;

export const runScheduledMarketingJobs = async (
  input: {
    now: string;
    pendingOlderThan: string;
    renderedBodiesOlderThan: string;
    engagementOlderThan: string;
    rawSnsInboxOlderThan: string;
    schedulerRunsOlderThan: string;
    schedulerIdleRunsOlderThan: string;
    sesIdentityRefreshIntervalMs: number;
    shouldContinue?: () => boolean;
    maintenanceIntervalMs?: number;
    trigger?: 'cron' | 'dev' | 'manual';
  },
  deps: {
    jobs: MarketingJobRepository;
    runs: SchedulerRunRepository;
    ids: IdGenerator;
    clock: Clock;
    dispatchCampaign(tenantId: string, campaignId: string): Promise<Result<unknown, AppError>>;
    runRetention(tenantId: string, input: {
      pendingOlderThan: string;
      renderedBodiesOlderThan: string;
      engagementOlderThan: string;
      rawSnsInboxOlderThan: string;
      idempotencyNow: string;
    }): Promise<Result<unknown, AppError>>;
    refreshIdentity(tenantId: string): Promise<Result<unknown, AppError>>;
    runReputationAlerts(
      tenantId: string,
    ): Promise<Result<{ sent: number }, AppError>>;
    logger: { warn(message: string): void };
  },
): Promise<Result<{
  campaignsDispatched: number;
  retentionTenantsProcessed: number;
  identityChecksPerformed: number;
  reputationAlertsSent: number;
}, AppError>> => {
  let firstError: AppError | null = null;
  await deps.runs.failStale({
    startedBefore: new Date(Date.parse(input.now) - 60 * 60 * 1000).toISOString(),
    finishedAt: input.now,
    error: 'Scheduler run exceeded its timeout',
  });
  const [previousMaintenance] = (await deps.runs.listPage({ kind: 'marketing_maintenance', status: 'completed', limit: 1 })).runs;
  const maintenanceDue = previousMaintenance === undefined
    || Date.parse(input.now) - Date.parse(previousMaintenance.startedAt) >= (input.maintenanceIntervalMs ?? 30 * 60 * 1000);
  const maintenanceRunId = maintenanceDue ? deps.ids.nextId() : null;
  const totals = { campaignsTouched: 0, sendsAttempted: 0, sent: 0, failed: 0, skipped: 0, reEnqueued: false };
  if (maintenanceRunId !== null) await deps.runs.start({
    id: maintenanceRunId, kind: 'marketing_maintenance', trigger: input.trigger ?? 'manual',
    startedAt: input.now, createdAt: input.now, finishedAt: null, durationMs: null, status: 'running', error: null, totals,
    idle: false,
  });
  let maintenanceIncomplete = false;
  if (maintenanceDue) {
    const purgeDeadlineMs = Date.now() + SCHEDULER_RUN_PURGE_TIME_BUDGET_MS;
    while (input.shouldContinue?.() !== false) {
      const remainingMs = purgeDeadlineMs - Date.now();
      if (remainingMs < SCHEDULER_RUN_PURGE_MIN_BATCH_MS) break;
      let batch: { purged: number; cancelled: boolean };
      try {
        batch = await deps.runs.purge({
          runsBefore: input.schedulerRunsOlderThan,
          idleRunsBefore: input.schedulerIdleRunsOlderThan,
        }, { batchSize: SCHEDULER_RUN_PURGE_BATCH_SIZE, timeoutMs: remainingMs });
      } catch {
        deps.logger.warn('[marketing] scheduler run purge stopped reason=purge_failed');
        break;
      }
      if (batch.cancelled) {
        deps.logger.warn('[marketing] scheduler run purge stopped reason=budget_exhausted');
        break;
      }
      if (batch.purged < SCHEDULER_RUN_PURGE_BATCH_SIZE) break;
    }
    if (input.shouldContinue?.() === false) maintenanceIncomplete = true;
  }
  const retentionTenantIds = !maintenanceDue ? [] : await deps.jobs.listRetentionTenantIds();
  for (const tenantId of retentionTenantIds) {
    if (input.shouldContinue?.() === false) { maintenanceIncomplete = true; break; }
    const retained = await deps.runRetention(tenantId, {
      pendingOlderThan: input.pendingOlderThan,
      renderedBodiesOlderThan: input.renderedBodiesOlderThan,
      engagementOlderThan: input.engagementOlderThan,
      rawSnsInboxOlderThan: input.rawSnsInboxOlderThan,
      idempotencyNow: input.now,
    });
    if (!retained.ok && firstError === null) firstError = retained.error;
  }
  const checkedBefore = new Date(
    Date.parse(input.now) - input.sesIdentityRefreshIntervalMs,
  ).toISOString();
  const [identityTenantIds, sesTenantIds] = !maintenanceDue ? [[], []] : await Promise.all([
    deps.jobs.listSesIdentityRefreshTenantIds(checkedBefore),
    deps.jobs.listSesTenantIds(checkedBefore),
  ]);
  for (const tenantId of identityTenantIds) {
    if (input.shouldContinue?.() === false) { maintenanceIncomplete = true; break; }
    const refreshed = await deps.refreshIdentity(tenantId);
    if (!refreshed.ok && firstError === null) firstError = refreshed.error;
  }
  let reputationAlertsSent = 0;
  for (const tenantId of sesTenantIds) {
    if (input.shouldContinue?.() === false) { maintenanceIncomplete = true; break; }
    const alerted = await deps.runReputationAlerts(tenantId);
    if (alerted.ok) reputationAlertsSent += alerted.value.sent;
    else if (firstError === null) firstError = alerted.error;
  }
  if (maintenanceRunId !== null) {
    const finishedAt = deps.clock.nowIso();
    const error = firstError?.message ?? (maintenanceIncomplete ? 'Marketing maintenance exceeded its time budget' : null);
    await deps.runs.finalize(maintenanceRunId, {
      finishedAt, durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(input.now)),
      status: error === null ? 'completed' : 'failed', error, totals, tenants: [],
      idle: retentionTenantIds.length === 0
        && identityTenantIds.length === 0
        && sesTenantIds.length === 0
        && error === null,
    });
  }
  const runnable = await deps.jobs.listRunnableCampaigns(input.now);
  let campaignsDispatched = 0;
  for (const job of runnable) {
    if (input.shouldContinue?.() === false) break;
    campaignsDispatched += 1;
    const dispatched = await deps.dispatchCampaign(job.tenantId, job.campaignId);
    if (!dispatched.ok && firstError === null) firstError = dispatched.error;
  }
  if (firstError !== null) return err(firstError);
  return ok({
    campaignsDispatched,
    retentionTenantsProcessed: retentionTenantIds.length,
    identityChecksPerformed: identityTenantIds.length,
    reputationAlertsSent,
  });
};
