import {
  buildMetaCapiPayload, err, forbidden, metaCapiBlockReason, metaCapiCopy, metaCapiDecisionSchema,
  metaCapiRetryAt, metaCapiWithdrawSchema, ok, tenantNotFound, validation, META_CAPI_GATEWAY_TIMEOUT_MS,
  DEFAULT_LANGUAGE, type Language, type AppError, type MetaCapiConfig, type MetaCapiDecisionInput, type MetaCapiEvent, type MetaCapiState, type Result, type TenantSettings,
} from '#core/domain/index.js';
import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { Clock, ContentHash, TenantDirectory, TenantRepository, TenantSecretResolver } from '../ports.js';
import type { MetaCapiGateway, MetaCapiJob, MetaCapiJobOutcome, MetaCapiOrderAccess, MetaCapiRepository } from '../meta-capi-ports.js';

export interface MetaCapiDeps {
  repository: MetaCapiRepository;
  tenants: Pick<TenantRepository, 'findSettings'>;
  clock: Clock;
  hash: ContentHash;
  secrets: TenantSecretResolver;
}

export const getMetaCapiConfig = async (tenantId: string, sessionId: string, deps: MetaCapiDeps, locale: Language = DEFAULT_LANGUAGE): Promise<MetaCapiConfig | undefined> => {
  const current = await deps.repository.findOrder(tenantId, { sessionId });
  const settings = await deps.tenants.findSettings(tenantId);
  if (!current || !settings) return undefined;
  const copy = metaCapiCopy(settings, locale);
  const eligible = !current.memberDeleted && settings.analyticsMetaCapiEnabled === true && !!settings.analyticsMetaPixelId && !!copy.privacyUrl
    && current.order.mode === 'live' && current.order.provider === 'stripe' && !sessionId.startsWith('cs_test_');
  const enabled = eligible && (await deps.secrets.resolve(tenantId, 'analyticsMetaCapiAccessToken')).ok;
  return { ...current.consent, ...copy, enabled, locale, textVersion: deps.hash.sha256(JSON.stringify(copy)) };
};

const recordDecision = async (
  tenantId: string, access: MetaCapiOrderAccess, decision: 'granted' | 'denied' | 'withdrawn',
  request: { locale?: Language; textVersion?: string; ip: string | null; userAgent: string | null; fbp: string | null }, deps: MetaCapiDeps,
): Promise<Result<MetaCapiState, AppError>> => {
  const settings = await deps.tenants.findSettings(tenantId);
  const copy = settings && metaCapiCopy(settings, request.locale);
  const configured = settings?.analyticsMetaCapiEnabled === true && !!settings.analyticsMetaPixelId && !!copy?.privacyUrl;
  const available = decision !== 'withdrawn' && configured && (await deps.secrets.resolve(tenantId, 'analyticsMetaCapiAccessToken')).ok;
  return deps.repository.decide(tenantId, access, async (current) => {
    if (decision !== 'withdrawn' && current.memberDeleted) return err(validation('This order is not eligible for Meta conversions'));
    if (!copy) return err(tenantNotFound());
    const textSnapshot = JSON.stringify(copy);
    const textVersion = deps.hash.sha256(textSnapshot);
    if (decision !== 'withdrawn' && current.consent.consent === 'undecided' && current.consent.withdrawnAt === null) {
      if (!available) return err(validation('Meta conversion consent is unavailable'));
      if (request.textVersion !== textVersion) return err(validation('The consent text changed; reload before deciding'));
      const reason = metaCapiBlockReason(current.order, { consent: 'granted', withdrawnAt: null }, true, deps.clock.nowIso());
      if (reason === 'blocked') return err(validation('This order is not eligible for Meta conversions'));
    }
    return ok({ decision, capture: { ...request, textVersion, textSnapshot, at: deps.clock.nowIso() } });
  });
};

export const recordPublicMetaCapiConsent = async (
  tenantId: string, input: MetaCapiDecisionInput, request: { ip: string | null; userAgent: string | null }, deps: MetaCapiDeps,
): Promise<Result<MetaCapiState, AppError>> => {
  const parsed = metaCapiDecisionSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid Meta conversion consent'));
  const value = parsed.data;
  const access = value.sessionId !== undefined ? { sessionId: value.sessionId } : { orderToken: value.orderToken ?? '' };
  return recordDecision(tenantId, access, value.decision, { ...request, locale: value.locale, fbp: value.fbp ?? null,
    ...(value.textVersion === undefined ? {} : { textVersion: value.textVersion }) }, deps);
};

export const withdrawMetaCapiConsent = async (ctx: Ctx, input: { orderId: string }, deps: MetaCapiDeps): Promise<Result<MetaCapiState, AppError>> => {
  const tenant = authorizeTenant(ctx, 'member:profile:self-write');
  if (!tenant.ok) return tenant;
  if (ctx.identity.memberId === null) return err(forbidden('Member account required'));
  const parsed = metaCapiWithdrawSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid order id'));
  return recordDecision(tenant.value, { orderId: parsed.data.orderId, memberId: ctx.identity.memberId }, 'withdrawn',
    { ip: null, userAgent: null, fbp: null }, deps);
};

export const listMetaCapiConsents = async (ctx: Ctx, deps: Pick<MetaCapiDeps, 'repository'>) => {
  const tenant = authorizeTenant(ctx, 'member:billing:read');
  if (!tenant.ok) return tenant;
  if (ctx.identity.memberId === null) return err(forbidden('Member account required'));
  return ok({ consents: await deps.repository.listMemberConsents(tenant.value, ctx.identity.memberId) });
};

export const listMetaCapiEvents = async (ctx: Ctx, deps: Pick<MetaCapiDeps, 'repository'>) => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:write');
  if (!tenant.ok) return tenant;
  return ok({ events: await deps.repository.listEvents(tenant.value) });
};

export interface MetaCapiDispatchDeps extends MetaCapiDeps {
  gateway: MetaCapiGateway;
  directory: TenantDirectory;
  logger?: { warn(message: string): void };
}

interface DispatchWorkspace {
  settings: TenantSettings | null;
  token: Result<string, AppError> | null;
}

const readDispatchWorkspace = async (tenantId: string, deps: MetaCapiDispatchDeps): Promise<DispatchWorkspace> => {
  const settings = await deps.tenants.findSettings(tenantId);
  const token = settings?.analyticsMetaCapiEnabled === true && settings.analyticsMetaPixelId
    ? await deps.secrets.resolve(tenantId, 'analyticsMetaCapiAccessToken') : null;
  return { settings, token };
};

const dispatchJob = async (tenantId: string, job: MetaCapiJob, { settings, token }: DispatchWorkspace, deps: MetaCapiDispatchDeps): Promise<MetaCapiJobOutcome> => {
  const now = deps.clock.nowIso();
  const event = (status: MetaCapiEvent['status'], fieldsSent: string[] = [], error: string | null = null, fbtraceId: string | null = null): MetaCapiJobOutcome => ({ event: {
    tenantId, transactionId: job.order.id, orderId: job.order.id, consentAt: job.consentAt, eventTime: job.order.paidAt ?? null,
    recordedAt: now, sentAt: status === 'sent' ? deps.clock.nowIso() : null, status, fbtraceId, error, fieldsSent,
  } });
  if (job.memberDeleted) return event('blocked');
  const blocked = metaCapiBlockReason(job.order, job.consent, settings?.analyticsMetaCapiEnabled === true, now);
  if (blocked) return event(blocked);
  if (!settings?.analyticsMetaPixelId || !job.email) return event('blocked');
  if (!token?.ok) return event('blocked');
  const payload = buildMetaCapiPayload({ order: job.order, email: job.email, sourceUrl: job.sourceUrl,
    ip: job.capture.ip, userAgent: job.capture.userAgent, fbp: job.capture.fbp, sha256: (value) => deps.hash.sha256(value) });
  const fields = ['event_name', 'action_source', 'event_time', 'event_id', 'event_source_url',
    ...Object.keys(payload.user_data).map((key) => `user_data.${key}`), ...Object.keys(payload.custom_data).map((key) => `custom_data.${key}`)];
  const sent = await deps.gateway.send(tenantId, { pixelId: settings.analyticsMetaPixelId, accessToken: token.value, payload,
    ...(settings.analyticsMetaCapiTestEventCode ? { testEventCode: settings.analyticsMetaCapiTestEventCode } : {}) });
  if (sent.ok) return event('sent', fields, null, sent.fbtraceId);
  const retryAt = metaCapiRetryAt(job.attempts + 1, sent.retryable, deps.clock.nowIso());
  return retryAt === null ? event('failed', fields, sent.error) : { retryAt };
};

export const dispatchMetaCapi = async (deps: MetaCapiDispatchDeps): Promise<{ processed: number }> => {
  let processed = 0;
  const startedAt = Date.parse(deps.clock.nowIso());
  const deadline = startedAt + 20_000;
  const due = new Set(await deps.repository.listDueTenantIds(deps.clock.nowIso()));
  if (due.size === 0) return { processed };
  const tenants = await deps.directory.listAll();
  const offset = tenants.length === 0 ? 0 : Math.floor(startedAt / 60_000) % tenants.length;
  let active = [...tenants.slice(offset), ...tenants.slice(0, offset)].filter((tenant) => due.has(tenant.id));
  while (active.length > 0) {
    const nextPass: typeof tenants = [];
    for (const tenant of active) {
      if (processed >= 20 || Date.parse(deps.clock.nowIso()) + META_CAPI_GATEWAY_TIMEOUT_MS > deadline) return { processed };
      try {
        const workspace = await readDispatchWorkspace(tenant.id, deps);
        const found = await deps.repository.processNext(tenant.id, deps.clock.nowIso(), (job) => dispatchJob(tenant.id, job, workspace, deps));
        if (found) {
          processed += 1;
          nextPass.push(tenant);
        }
      } catch {
        deps.logger?.warn('[meta-capi] tenant_dispatch_failed');
      }
    }
    active = nextPass;
  }
  return { processed };
};
