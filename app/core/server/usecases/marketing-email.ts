import {
  appError,
  buildEmailHeaders,
  campaignCanEditContent,
  campaignCanTransition,
  classifySesEvent,
  deriveConsentState,
  deriveEmailReputation,
  deriveMarketingEligibility,
  emailEventSchema,
  err,
  forbidden,
  liftSuppression,
  normalizeEmail,
  notFound,
  ok,
  renderMarketingTemplate,
  reputationWindow,
  throttleBudget,
  tenantSesBroadcastsReady,
  validateRenderedMarketingOutput,
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
  type MarketingConsent,
  type MarketingIneligibilityReason,
  type Result,
  type Suppression,
  type TenantSesSettings,
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
  SesMarketingQuotaReader,
  SesMarketingSender,
  SuppressionRepository,
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
    doubleOptIn: input.doubleOptIn, documentRef,
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
  const queued = await deps.outbox.enqueue({
    id: deps.ids.nextId(), tenantId: tenantId.value, to: consent.email, now,
    payload: {
      kind: 'marketing-consent-confirmation', wording: consent.wordingSnapshot,
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

export const purgeStalePendingConsents = async (
  ctx: Ctx,
  input: { olderThan: string },
  deps: Pick<ConsentDeps, 'consents' | 'definitions'>,
): Promise<Result<{ purged: number }, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'marketing:consent:write');
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
    evidence: ConsentEvidence;
    confirmationBaseUrl: string;
  },
  deps: UnsubscribeDeps & Pick<ConsentDeps, 'confirmations' | 'outbox' | 'tokens'>,
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
  const emailHmac = deps.hmac.compute(tenantId.value, token.email);
  if (selectedIds.size > 0 && await deps.suppressions.isSuppressed(tenantId.value, emailHmac)) {
    return err(validation('Globally unsubscribed addresses cannot re-subscribe from this page'));
  }
  let pendingConfirmations = 0;
  for (const definition of definitions) {
    const state = deriveConsentState(
      await deps.consents.listByEmail(tenantId.value, token.email, definition.id),
      definition,
    );
    const selected = selectedIds.has(definition.id);
    if (!selected && state.state !== 'none' && state.state !== 'withdrawn') {
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
    consentDefinitionId: string;
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
  const now = deps.clock.nowIso();
  const campaign: Campaign = {
    id: deps.ids.nextId(), tenantId: tenantId.value, name: input.name, subject: input.subject,
    bodyHtml: input.bodyHtml, bodySource: input.bodySource ?? input.bodyHtml, layoutId: input.layoutId ?? null, consentDefinitionId: input.consentDefinitionId,
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
): Promise<Result<Campaign & { engagement: CampaignEngagementStats }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:campaign:read');
  if (!tenantId.ok) return tenantId;
  const campaign = await getCampaign(ctx, input, deps);
  if (!campaign.ok) return campaign;
  const stats = await deps.sends.engagementStats(campaign.value.tenantId, [campaign.value.id]);
  return ok({ ...campaign.value, engagement: stats.get(campaign.value.id) ?? emptyEngagementStats() });
};

export const listCampaignsWithEngagement = async (
  ctx: Ctx,
  deps: { campaigns: CampaignRepository; sends: CampaignSendRepository },
): Promise<Result<Array<Campaign & { engagement: CampaignEngagementStats }>, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:campaign:read');
  if (!tenantId.ok) return tenantId;
  const campaigns = await deps.campaigns.list(tenantId.value);
  const stats = await deps.sends.engagementStats(tenantId.value, campaigns.map((campaign) => campaign.id));
  return ok(campaigns.map((campaign) => ({
    ...campaign,
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

export const updateCampaignContent = async (
  ctx: Ctx,
  input: { campaignId: string; subject: string; bodyHtml: string },
  deps: CampaignDeps,
): Promise<Result<Campaign, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:campaign:write');
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
  unsubscribeBaseUrl: string;
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
  const tenantId = tenantIdFrom(ctx, 'marketing:message:send');
  if (!tenantId.ok) return tenantId;
  let settings = await deps.sesSettings.findByTenant(tenantId.value);
  if (settings === null) return err(appError('ses_not_configured', 'Tenant SES is not configured'));
  if (settings.trackingEnabled && settings.configurationSet === null) {
    return err(validation('Open and click tracking requires an SES configuration set'));
  }
  const credentials = await deps.credentials.resolve(tenantId.value);
  if (!credentials.ok) return credentials;
  const now = deps.clock.nowIso();
  if (deps.quotaReader !== undefined && (settings.quotaRefreshedAt === null
    || Date.parse(now) - Date.parse(settings.quotaRefreshedAt) >= 15 * 60 * 1000)) {
    const quota = await deps.quotaReader.read(credentials.value);
    if (!quota.ok) return quota;
    settings = await deps.sesSettings.upsert(tenantId.value, {
      ...settings,
      quotaRatePerSec: quota.value.ratePerSecond,
      quotaDaily: quota.value.daily,
      quotaSentLast24Hours: quota.value.sentLast24Hours,
      quotaRefreshedAt: now,
      inSandbox: quota.value.inSandbox,
    });
  }
  if (!tenantSesBroadcastsReady(settings)) return err(appError('broadcasts_disabled', 'Marketing broadcasts are disabled'));
  if (settings.quotaRefreshedAt === null || !await deps.throttle.claim(tenantId.value, {
    requested: inputs.length,
    now,
    ratePerSecond: settings.quotaRatePerSec,
    dailyQuota: settings.quotaDaily,
    sentLast24Hours: settings.quotaSentLast24Hours,
    quotaSnapshotAt: settings.quotaRefreshedAt,
  })) return err(appError('rate_limited', 'Tenant SES throttle budget is exhausted'));
  const results: MarketingSendResult[] = [];
  for (const input of inputs) {
    const initial = await eligibilityFor(tenantId.value, input, deps);
    if (initial === null) return err(notFound('Consent definition was not found'));
    if (!initial.eligibility.eligible) {
      const skippedId = input.campaignId === null || initial.latest === null ? null : deps.ids.nextId();
      if (skippedId !== null && initial.latest !== null) {
        const skipped: CampaignSend = {
          id: skippedId, runId: deps.runId ?? null, tenantId: tenantId.value, campaignId: input.campaignId, source: input.source,
          memberId: input.memberId, email: normalizeEmail(input.to), subject: input.subject,
          consentRowId: initial.latest.id,
          unsubscribeTokenId: null, status: 'skipped', skipReason: initial.eligibility.reason,
          sesMessageId: null, deliveryStatus: null, deliveryOccurredAt: null,
          idempotencySource: input.idempotencySource ?? null, renderedBodyPurgedAt: null,
          createdAt: deps.clock.nowIso(), sentAt: null,
        };
        await deps.sends.claimRecipient(tenantId.value, skipped, [
          lifecycleEvent(
            deps,
            tenantId.value,
            'marketing',
            skipped.id,
            'skipped',
            { reason: initial.eligibility.reason },
          ),
        ]);
      }
      results.push({ to: normalizeEmail(input.to), sendId: skippedId, status: 'skipped', reason: initial.eligibility.reason });
      continue;
    }
    const sendId = deps.ids.nextId();
    const send: CampaignSend = {
      id: sendId, runId: deps.runId ?? null, tenantId: tenantId.value, campaignId: input.campaignId, source: input.source,
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
    const unsubscribeUrl = `${deps.unsubscribeBaseUrl}/${token}`;
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
    const sending = { ...send, unsubscribeTokenId, status: 'sending' as const };
    await deps.sends.update(
      tenantId.value,
      sending,
      [lifecycleEvent(deps, tenantId.value, 'marketing', send.id, 'rendered', null)],
    );
    const sent = await deps.ses.send({
      credentials: credentials.value, from: { address: settings.fromAddress, name: settings.fromName },
      to: send.email, subject: rendered.value.subject, html: rendered.value.html, text: rendered.value.text,
      headers: rendered.value.headers,
      configurationSet: settings.configurationSet,
    });
    if (!sent.ok) {
      await deps.sends.update(
        tenantId.value,
        { ...sending, status: 'failed' },
        [lifecycleEvent(
          deps,
          tenantId.value,
          'marketing',
          send.id,
          'failed',
          { error: sent.error.message },
        )],
      );
      results.push({ to: send.email, sendId, status: 'failed', error: sent.error });
      continue;
    }
    await deps.sends.update(
      tenantId.value,
      { ...sending, status: 'sent', sesMessageId: sent.value.messageId, sentAt: deps.clock.nowIso() },
      [lifecycleEvent(
        deps,
        tenantId.value,
        'marketing',
        send.id,
        'accepted',
        { sesMessageId: sent.value.messageId },
      )],
    );
    results.push({ to: send.email, sendId, status: 'sent' });
  }
  return ok(results);
};

interface TickDeps extends SendDeps {
  campaigns: CampaignRepository;
  audience: MarketingAudienceRepository;
  outbox: EmailOutboxRepository;
  scheduler: SchedulerPort;
  runs: SchedulerRunRepository;
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
  if (deps.outbox.hasPendingForTenant !== undefined && await deps.outbox.hasPendingForTenant(tenantId.value)) {
    const scheduled = await scheduleNextTick();
    if (!scheduled.ok) return scheduled;
    return ok({ leased: true, yieldedToTransactional: true, sent: 0, failed: 0, skipped: 0 });
  }
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
  const sentSince = new Date(Date.parse(now) - 24 * 60 * 60 * 1000).toISOString();
  const sentLast24Hours = (await deps.sends.listAll(tenantId.value))
    .filter((send) => send.status === 'sent' && send.sentAt !== null && send.sentAt >= sentSince)
    .length;
  const tickBudget = throttleBudget({
    ratePerSecond: settings.quotaRatePerSec, tickSeconds: input.tickSeconds,
    dailyQuota: settings.quotaDaily, sentLast24Hours, inSandbox: settings.inSandbox,
  });
  const budget = Math.min(tickBudget, Math.max(1, Math.floor(settings.quotaRatePerSec)));
  metrics.budgetComputed = budget;
  const maxMemberId = campaign.snapshotMaxMemberId;
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
  const members = await deps.audience.fetchEligibleBatch(tenantId.value, {
    definitionId: campaign.consentDefinitionId, productIds: campaign.audienceFilter?.productIds ?? [],
    afterMemberId: campaign.cursorMemberId, maxMemberId, limit: budget,
  });
  metrics.batchSize = members.length;
  metrics.budgetUsed = members.length;
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
      metrics.sent += 1;
      consecutiveErrors = 0;
      lastError = null;
    }
    else if (item?.status === 'failed') {
      failedCount += 1;
      metrics.failed += 1;
      consecutiveErrors += 1;
      lastError = item.error.message;
      metrics.errors.push(item.error.message);
    }
    else if (item?.status === 'skipped') {
      skippedCount += 1;
      metrics.skipped += 1;
    }
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
  } else if (current.status === 'running') {
    const scheduled = await scheduleNextTick();
    if (!scheduled.ok) return scheduled;
  }
  return ok({ leased: true, yieldedToTransactional: false, sent: sentCount, failed: failedCount, skipped: skippedCount });
};

export const campaignTick = async (
  ctx: Ctx,
  input: { campaignId: string; workerId: string; tickSeconds: number; errorThreshold?: number; trigger?: 'cron' | 'dev' | 'manual' },
  deps: TickDeps,
): Promise<Result<{ leased: boolean; yieldedToTransactional: boolean; sent: number; failed: number; skipped: number }, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'marketing:campaign:dispatch');
  if (!tenantId.ok) return tenantId;
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
  const credentials = await deps.credentials.resolve(tenantId.value);
  if (!credentials.ok) return credentials;
  if (!tenantSesBroadcastsReady(settings)) return err(appError('broadcasts_disabled', 'Marketing broadcasts are disabled'));
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
    configurationSet: null,
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

type VerifiedSesEvent = {
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

export const applyVerifiedSesEvent = async (
  ctx: Ctx,
  event: VerifiedSesEvent,
  deps: Pick<SendDeps, 'sesSettings' | 'sends' | 'events' | 'suppressions' | 'hmac' | 'ids' | 'clock'>
    & { outbox: EmailOutboxRepository },
): Promise<Result<{ processed: boolean }, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'webhook:process');
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
    if (send === null) {
      if (event.kind === 'open' || event.kind === 'click') return ok({ processed: false });
      if (deps.outbox.correlateBySesMessageId === undefined || deps.outbox.markDelivery === undefined) {
        return ok({ processed: false });
      }
      const outbox = await deps.outbox.correlateBySesMessageId(tenantId.value, event.messageId);
      if (outbox === null) return ok({ processed: false });
      const classification = event.kind === 'delivery'
        ? null
        : classifySesEvent(event);
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
      if (!marked.ok) return ok({ processed: false });
      if (classification === 'hard' || classification === 'complaint') {
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
      return ok({ processed: true });
    }
    if (event.kind === 'open' || event.kind === 'click') {
      if (!settings.trackingEnabled) return ok({ processed: false });
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
      return ok({ processed: true });
    }
    if (event.kind === 'delivery') {
      await deps.sends.update(
        tenantId.value,
        { ...send, deliveryStatus: 'delivered', deliveryOccurredAt: event.occurredAt },
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
      return ok({ processed: true });
    }
    const classification = classifySesEvent(event);
    const deliveryStatus = classification === 'complaint' ? 'complained' : 'bounced';
    await deps.sends.update(
      tenantId.value,
      { ...send, deliveryStatus, deliveryOccurredAt: event.occurredAt },
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
    if (classification !== 'soft') {
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
    return ok({ processed: true });
  } catch {
    return ok({ processed: false });
  }
};

export const runMarketingRetentionJobs = async (
  ctx: Ctx,
  input: {
    pendingOlderThan: string;
    renderedBodiesOlderThan: string;
    engagementOlderThan: string;
    idempotencyNow: string;
  },
  deps: Pick<ConsentDeps, 'consents' | 'definitions' | 'clock'> & {
    sends: CampaignSendRepository;
    events: EmailEventRepository;
    idempotency: AutomationIdempotencyRepository;
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

export const runScheduledMarketingJobs = async (
  input: {
    now: string;
    pendingOlderThan: string;
    renderedBodiesOlderThan: string;
    engagementOlderThan: string;
    sesIdentityRefreshIntervalMs: number;
  },
  deps: {
    jobs: MarketingJobRepository;
    runs: SchedulerRunRepository;
    dispatchCampaign(tenantId: string, campaignId: string): Promise<Result<unknown, AppError>>;
    runRetention(tenantId: string, input: {
      pendingOlderThan: string;
      renderedBodiesOlderThan: string;
      engagementOlderThan: string;
      idempotencyNow: string;
    }): Promise<Result<unknown, AppError>>;
    refreshIdentity(tenantId: string): Promise<Result<unknown, AppError>>;
    runReputationAlerts(
      tenantId: string,
    ): Promise<Result<{ sent: number }, AppError>>;
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
  const runnable = await deps.jobs.listRunnableCampaigns(input.now);
  for (const job of runnable) {
    const dispatched = await deps.dispatchCampaign(job.tenantId, job.campaignId);
    if (!dispatched.ok && firstError === null) firstError = dispatched.error;
  }
  const retentionTenantIds = await deps.jobs.listRetentionTenantIds();
  for (const tenantId of retentionTenantIds) {
    const retained = await deps.runRetention(tenantId, {
      pendingOlderThan: input.pendingOlderThan,
      renderedBodiesOlderThan: input.renderedBodiesOlderThan,
      engagementOlderThan: input.engagementOlderThan,
      idempotencyNow: input.now,
    });
    if (!retained.ok && firstError === null) firstError = retained.error;
  }
  const checkedBefore = new Date(
    Date.parse(input.now) - input.sesIdentityRefreshIntervalMs,
  ).toISOString();
  const [identityTenantIds, sesTenantIds] = await Promise.all([
    deps.jobs.listSesIdentityRefreshTenantIds(checkedBefore),
    deps.jobs.listSesTenantIds(checkedBefore),
  ]);
  for (const tenantId of identityTenantIds) {
    const refreshed = await deps.refreshIdentity(tenantId);
    if (!refreshed.ok && firstError === null) firstError = refreshed.error;
  }
  let reputationAlertsSent = 0;
  for (const tenantId of sesTenantIds) {
    const alerted = await deps.runReputationAlerts(tenantId);
    if (alerted.ok) reputationAlertsSent += alerted.value.sent;
    else if (firstError === null) firstError = alerted.error;
  }
  if (firstError !== null) return err(firstError);
  return ok({
    campaignsDispatched: runnable.length,
    retentionTenantsProcessed: retentionTenantIds.length,
    identityChecksPerformed: identityTenantIds.length,
    reputationAlertsSent,
  });
};
