import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Context, Hono } from 'hono';
import { z } from 'zod';

import {
  API_KEY_HEADER,
  capabilitiesForPrincipal,
  HTTP_STATUS_BY_ERROR_CODE,
  m2mTransactionalMessageRequestSchema,
  TENANT_HEADER,
  toEnvelope,
} from '#core/contract/index.js';
import {
  appError,
  capabilitiesForApiKey,
  err,
  marketingAutomationMessagesSchema,
  marketingConsentApiSchema,
  marketingEligibilityQuerySchema,
  marketingMessagesQuerySchema,
  marketingSuppressionApiSchema,
  marketingSuppressionQuerySchema,
  normalizeEmail,
  ok,
  tenantNotFound,
  unauthorized,
  validation,
  type AppError,
  type Identity,
  type Result,
  type Tenant,
  type TenantApiKey,
} from '#core/domain/index.js';
import {
  addManualSuppression,
  applyVerifiedSesEvent,
  authenticateApiKey,
  claimIdempotencyKey,
  completeIdempotentRequest,
  confirmMarketingConsent,
  getMarketingEligibility,
  getUnsubscribePreferences,
  recordMarketingConsent,
  resolveTenant,
  saveMarketingConsentPreferences,
  sendM2mTransactionalMessage,
  sendMarketingMessages,
  getM2mTransactionalMessage,
  unsubscribeAllMarketing,
  unsubscribeOneClick,
  type Ctx,
} from '#core/server/index.js';

import type { AppDeps, MarketingAppDeps } from './composition.js';
import {
  languageFromRequest,
  renderConfirmationPage,
  renderLegalDocumentPage,
  renderPreferenceResultPage,
  renderPreferencesPage,
  type PublicBrand,
} from './public-marketing-pages.js';

type Vars = { Variables: { identity: Identity; secureHeadersNonce?: string } };

const response = <T>(result: Result<T, AppError>, successStatus = 200, headers?: HeadersInit): Response => {
  const envelope = toEnvelope(result);
  return new Response(JSON.stringify(envelope), {
    status: envelope.ok ? successStatus : HTTP_STATUS_BY_ERROR_CODE[envelope.error.code],
    headers: { 'content-type': 'application/json', ...headers },
  });
};

const requireMarketing = (deps: AppDeps): Result<MarketingAppDeps, AppError> => deps.marketing === undefined
  ? err(appError('integration_not_configured', 'Marketing e-mail is not configured'))
  : ok(deps.marketing);

const apiIdentity = (tenant: Tenant): Identity => ({
  userId: 'api-key', email: 'api-key@together.invalid', name: 'Automation API', emailVerified: true,
  image: null,
  tenantId: tenant.id, tenantSlug: tenant.slug, tenantName: tenant.name,
  staffRole: null, memberId: null, memberDisplayName: null, memberBannedAt: null,
  memberDmOptOutAt: null,
});

const tokenCtx = (tenant: Tenant): Ctx => ({
  identity: apiIdentity(tenant),
  capabilities: capabilitiesForPrincipal('token'),
});

export const authenticateMarketingApiKey = async (
  headers: Headers,
  deps: AppDeps,
): Promise<Result<{ tenant: Tenant; apiKey: TenantApiKey; ctx: Ctx }, AppError>> => {
  const resolved = await resolveTenant(headers.get('host') ?? '', headers.get(TENANT_HEADER), deps);
  if (!resolved.ok) return resolved;
  if (resolved.value === null) return err(tenantNotFound());
  const key = headers.get(API_KEY_HEADER);
  if (key === null) return err(unauthorized('Missing API key'));
  const authenticated = await authenticateApiKey(resolved.value.tenant.id, key, deps);
  return authenticated.ok
    ? ok({
        tenant: resolved.value.tenant,
        apiKey: authenticated.value,
        ctx: {
          identity: apiIdentity(resolved.value.tenant),
          capabilities: capabilitiesForApiKey(authenticated.value),
        },
      })
    : authenticated;
};

const sendDeps = (deps: AppDeps, marketing: MarketingAppDeps, unsubscribeBaseUrl: string) => ({
  definitions: marketing.definitions,
  consents: marketing.marketingConsents,
  suppressions: marketing.suppressions,
  hmac: marketing.hmac,
  sends: marketing.campaignSends,
  events: marketing.events,
  layouts: marketing.layouts,
  unsubscribes: marketing.unsubscribes,
  sesSettings: marketing.sesSettings,
  ses: marketing.marketingSes,
  credentials: marketing.marketingCredentials,
  quotaReader: marketing.quotaReader,
  throttle: marketing.throttle,
  ids: deps.ids,
  tokens: { nextToken: () => randomBytes(24).toString('base64url') },
  clock: deps.clock,
  unsubscribeBaseUrl,
});

const readJson = async (request: Request): Promise<unknown> => request.json().catch(() => null);

const queryObject = (url: string): Record<string, string> => Object.fromEntries(new URL(url).searchParams.entries());

const sesDeliveryEventSchema = z.discriminatedUnion('notificationType', [
  z.object({
    notificationType: z.literal('Bounce'),
    mail: z.object({ messageId: z.string().min(1), timestamp: z.string().datetime() }),
    bounce: z.object({
      bounceType: z.string().min(1),
      timestamp: z.string().datetime(),
      bouncedRecipients: z.array(z.object({ status: z.string().nullable().optional() })).min(1),
    }).passthrough(),
  }).passthrough(),
  z.object({
    notificationType: z.literal('Complaint'),
    mail: z.object({ messageId: z.string().min(1), timestamp: z.string().datetime() }),
    complaint: z.object({ timestamp: z.string().datetime() }).passthrough(),
  }).passthrough(),
  z.object({
    notificationType: z.literal('Delivery'),
    mail: z.object({ messageId: z.string().min(1), timestamp: z.string().datetime() }),
    delivery: z.object({ timestamp: z.string().datetime() }).passthrough(),
  }).passthrough(),
]);

const sesConfigurationSetEventSchema = z.discriminatedUnion('eventType', [
  z.object({
    eventType: z.literal('Open'),
    mail: z.object({ messageId: z.string().min(1), timestamp: z.string().datetime() }),
    open: z.object({ timestamp: z.string().datetime() }).passthrough(),
  }).passthrough(),
  z.object({
    eventType: z.literal('Click'),
    mail: z.object({ messageId: z.string().min(1), timestamp: z.string().datetime() }),
    click: z.object({
      timestamp: z.string().datetime(),
      link: z.string().min(1),
    }).passthrough(),
  }).passthrough(),
  z.object({
    eventType: z.literal('Bounce'),
    mail: z.object({ messageId: z.string().min(1), timestamp: z.string().datetime() }),
    bounce: z.object({
      bounceType: z.string().min(1),
      timestamp: z.string().datetime(),
      bouncedRecipients: z.array(z.object({ status: z.string().nullable().optional() })).min(1),
    }).passthrough(),
  }).passthrough(),
  z.object({
    eventType: z.literal('Complaint'),
    mail: z.object({ messageId: z.string().min(1), timestamp: z.string().datetime() }),
    complaint: z.object({ timestamp: z.string().datetime() }).passthrough(),
  }).passthrough(),
  z.object({
    eventType: z.literal('Delivery'),
    mail: z.object({ messageId: z.string().min(1), timestamp: z.string().datetime() }),
    delivery: z.object({ timestamp: z.string().datetime() }).passthrough(),
  }).passthrough(),
]);

const sesEventDiscriminatorSchema = z.union([
  z.object({ eventType: z.string().min(1) }).passthrough(),
  z.object({ notificationType: z.string().min(1) }).passthrough(),
]);

const publicBrand = async (deps: AppDeps, tenant: Tenant): Promise<PublicBrand> => ({
  tenant,
  settings: await deps.tenants.findSettings(tenant.id),
});

const html = (body: string): Response => new Response(body, {
  status: 200,
  headers: { 'content-type': 'text/html; charset=UTF-8', 'cache-control': 'no-store' },
});

const pageNonce = (context: Context<Vars>): string => {
  const nonce = context.get('secureHeadersNonce');
  if (nonce === undefined) throw new Error('Secure headers nonce is unavailable');
  return nonce;
};

const unsubscribeDeps = (deps: AppDeps, marketing: MarketingAppDeps) => ({
  definitions: marketing.definitions,
  consents: marketing.marketingConsents,
  suppressions: marketing.suppressions,
  hmac: marketing.hmac,
  unsubscribes: marketing.unsubscribes,
  events: marketing.events,
  ids: deps.ids,
  clock: deps.clock,
});

export const registerAuthenticatedMarketingRoutes = (app: Hono<Vars>, deps: AppDeps): void => {
  app.post('/api/m2m/transactional/messages', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const authenticated = await authenticateMarketingApiKey(c.req.raw.headers, deps);
    if (!authenticated.ok) return response(authenticated);
    const parsed = m2mTransactionalMessageRequestSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) return response(err(validation('Invalid transactional e-mail payload', parsed.error.flatten())));
    const sent = await sendM2mTransactionalMessage(
      authenticated.value.ctx,
      authenticated.value.apiKey,
      parsed.data,
      {
        idempotency: marketing.value.idempotency,
        rateLimits: deps.apiKeyRateLimits,
        limits: deps.m2mTransactionalRateLimits,
        transports: deps.emailTransports,
        suppressions: marketing.value.suppressions,
        hmac: marketing.value.hmac,
        outbox: deps.emailOutbox,
        events: marketing.value.events,
        ids: deps.ids,
        clock: deps.clock,
        hash: { compute: (value) => createHash('sha256').update(value).digest('hex') },
      },
    );
    if (!sent.ok) {
      const retryAfterSeconds = sent.error.code === 'rate_limited'
        && typeof sent.error.details === 'object'
        && sent.error.details !== null
        && typeof Reflect.get(sent.error.details, 'retryAfterSeconds') === 'number'
        ? String(Reflect.get(sent.error.details, 'retryAfterSeconds'))
        : null;
      return response(sent, undefined, retryAfterSeconds === null ? undefined : { 'retry-after': retryAfterSeconds });
    }
    if (!sent.value.replayed) deps.dispatchEmail();
    const statusUrl = `/api/m2m/transactional/messages/${encodeURIComponent(sent.value.messageId)}`;
    return response(ok({ messageId: sent.value.messageId, statusUrl }), sent.value.replayed ? 200 : 202);
  });

  app.get('/api/m2m/transactional/messages/:id', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const authenticated = await authenticateMarketingApiKey(c.req.raw.headers, deps);
    if (!authenticated.ok) return response(authenticated);
    return response(await getM2mTransactionalMessage(
      authenticated.value.ctx,
      authenticated.value.apiKey,
      { id: c.req.param('id') },
      { sends: marketing.value.emailSends, events: marketing.value.events },
    ));
  });

  app.post('/api/m2m/marketing/messages', async (c) => {
    const marketingResult = requireMarketing(deps);
    if (!marketingResult.ok) return response(marketingResult);
    const authenticated = await authenticateMarketingApiKey(c.req.raw.headers, deps);
    if (!authenticated.ok) return response(authenticated);
    const rawBody = await c.req.text();
    const idempotencyKey = c.req.header('Idempotency-Key');
    if (idempotencyKey !== undefined) {
      const claimed = await claimIdempotencyKey(authenticated.value.ctx, {
        key: idempotencyKey,
        method: 'POST',
        path: '/api/m2m/marketing/messages',
        requestHash: createHash('sha256').update(rawBody).digest('hex'),
        ttlSeconds: 86_400,
      }, { repository: marketingResult.value.idempotency, ids: deps.ids, clock: deps.clock });
      if (!claimed.ok) return response(claimed);
    }
    const json: unknown = (() => { try { return JSON.parse(rawBody); } catch { return null; } })();
    const parsed = marketingAutomationMessagesSchema.safeParse(json);
    if (!parsed.success) {
      if (idempotencyKey !== undefined) await completeIdempotentRequest(authenticated.value.ctx, { key: idempotencyKey, status: 400 }, { repository: marketingResult.value.idempotency });
      return response(err(validation('Invalid marketing messages payload', parsed.error.flatten())));
    }
    const templates = new Map<string, Awaited<ReturnType<MarketingAppDeps['campaigns']['findById']>>>();
    for (const message of parsed.data.messages) {
      if (message.templateId === undefined || templates.has(message.templateId)) continue;
      const template = await marketingResult.value.campaigns.findById(authenticated.value.tenant.id, message.templateId);
      if (template === null) {
        if (idempotencyKey !== undefined) await completeIdempotentRequest(authenticated.value.ctx, { key: idempotencyKey, status: 400 }, { repository: marketingResult.value.idempotency });
        return response(err(validation('The requested marketing template was not found')));
      }
      templates.set(message.templateId, template);
    }
    const campaignIds = new Map<string, string>();
    const existingCampaigns = await marketingResult.value.campaigns.list(authenticated.value.tenant.id);
    for (const message of parsed.data.messages) {
      if (message.campaignKey === undefined || campaignIds.has(message.campaignKey)) continue;
      const name = `API: ${message.campaignKey}`;
      const existing = existingCampaigns.find((campaign) => campaign.name === name);
      const campaignId = existing?.id ?? randomUUID();
      if (existing === undefined) {
        const now = deps.clock.nowIso();
        await marketingResult.value.campaigns.create(authenticated.value.tenant.id, {
          id: campaignId, tenantId: authenticated.value.tenant.id, name,
          subject: message.subject ?? 'Automation message', bodyHtml: message.bodyHtml ?? '<p></p>',
          bodySource: message.bodyHtml ?? '<p></p>', layoutId: null,
          consentDefinitionId: message.consentDefinitionId, audienceFilter: null, status: 'running',
          sendAt: null, snapshotMaxMemberId: null, cursorMemberId: null, toSend: 0, sent: 0,
          failed: 0, lockedUntil: null, lockedBy: null, errorCount: 0, pausedReason: null,
          audienceNameSnapshot: name, consentLabelSnapshot: null, startedAt: now, finishedAt: null, createdAt: now,
        });
      }
      campaignIds.set(message.campaignKey, campaignId);
    }
    const sent = await sendMarketingMessages(authenticated.value.ctx, parsed.data.messages.map((message) => {
      const template = message.templateId === undefined ? null : templates.get(message.templateId) ?? null;
      return {
        to: message.to,
        memberId: null,
        campaignId: message.campaignKey === undefined ? null : campaignIds.get(message.campaignKey) ?? null,
        source: 'api',
        consentDefinitionId: message.consentDefinitionId,
        subject: message.subject ?? template?.subject ?? '',
        bodyHtml: message.bodyHtml ?? template?.bodyHtml ?? '',
        layoutId: template?.layoutId ?? null,
        data: message.data,
        ...(idempotencyKey === undefined ? {} : { idempotencySource: idempotencyKey }),
      };
    }), sendDeps(deps, marketingResult.value, `${new URL(c.req.url).origin}/u`));
    const status = sent.ok ? 202 : HTTP_STATUS_BY_ERROR_CODE[sent.error.code];
    if (idempotencyKey !== undefined) await completeIdempotentRequest(authenticated.value.ctx, { key: idempotencyKey, status }, { repository: marketingResult.value.idempotency });
    if (!sent.ok) return sent.error.code === 'rate_limited'
      ? response(sent, undefined, { 'retry-after': '1' })
      : response(sent);
    return response(ok({ results: sent.value.map((item) => item.status === 'sent'
      ? { to: item.to, sendId: item.sendId, status: 'queued' as const }
      : item) }), 202);
  });

  app.get('/api/m2m/marketing/eligibility', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const authenticated = await authenticateMarketingApiKey(c.req.raw.headers, deps);
    if (!authenticated.ok) return response(authenticated);
    const parsed = marketingEligibilityQuerySchema.safeParse(queryObject(c.req.url));
    if (!parsed.success) return response(err(validation('Invalid eligibility query', parsed.error.flatten())));
    let definitionId = parsed.data.definitionId;
    if (definitionId === undefined) {
      const definitions = await marketing.value.definitions.list(authenticated.value.tenant.id, 'active');
      definitionId = definitions.find((definition) => definition.kind === 'optional_marketing')?.id;
    }
    if (definitionId === undefined) return response(err(validation('No active marketing consent definition exists')));
    return response(await getMarketingEligibility(authenticated.value.ctx, {
      email: parsed.data.email, definitionId,
    }, { definitions: marketing.value.definitions, consents: marketing.value.marketingConsents, suppressions: marketing.value.suppressions, hmac: marketing.value.hmac }));
  });

  app.post('/api/m2m/marketing/consents', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const authenticated = await authenticateMarketingApiKey(c.req.raw.headers, deps);
    if (!authenticated.ok) return response(authenticated);
    const parsed = marketingConsentApiSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) return response(err(validation('Invalid marketing consent payload', parsed.error.flatten())));
    const { email, memberId, definitionId, collectedAt, source, proofRef, ip, userAgent } = parsed.data;
    return response(await recordMarketingConsent(authenticated.value.ctx, {
      email, memberId, definitionId, source,
      evidence: { collectedAt, proofRef, ...(ip === undefined ? {} : { ip }), ...(userAgent === undefined ? {} : { userAgent }) },
      confirmationBaseUrl: `${new URL(c.req.url).origin}/marketing/confirm`,
    }, {
      definitions: marketing.value.definitions, consents: marketing.value.marketingConsents,
      confirmations: marketing.value.confirmations, outbox: deps.emailOutbox, ids: deps.ids,
      tokens: { nextToken: () => randomBytes(24).toString('base64url') },
      clock: deps.clock,
    }), 201);
  });

  app.get('/api/m2m/marketing/suppressions', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const authenticated = await authenticateMarketingApiKey(c.req.raw.headers, deps);
    if (!authenticated.ok) return response(authenticated);
    const parsed = marketingSuppressionQuerySchema.safeParse(queryObject(c.req.url));
    if (!parsed.success) return response(err(validation('Invalid suppression query', parsed.error.flatten())));
    const emailHmac = parsed.data.email === undefined ? undefined : marketing.value.hmac.compute(authenticated.value.tenant.id, normalizeEmail(parsed.data.email));
    return response(ok(await marketing.value.suppressions.list(authenticated.value.tenant.id, {
      ...(emailHmac === undefined ? {} : { emailHmac }),
      ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
      limit: parsed.data.limit,
    })));
  });

  app.post('/api/m2m/marketing/suppressions', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const authenticated = await authenticateMarketingApiKey(c.req.raw.headers, deps);
    if (!authenticated.ok) return response(authenticated);
    const parsed = marketingSuppressionApiSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) return response(err(validation('Invalid suppression payload', parsed.error.flatten())));
    return response(await addManualSuppression(authenticated.value.ctx, parsed.data, {
      suppressions: marketing.value.suppressions, hmac: marketing.value.hmac, ids: deps.ids, clock: deps.clock,
    }), 201);
  });

  app.get('/api/m2m/marketing/messages', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const authenticated = await authenticateMarketingApiKey(c.req.raw.headers, deps);
    if (!authenticated.ok) return response(authenticated);
    const parsed = marketingMessagesQuerySchema.safeParse(queryObject(c.req.url));
    if (!parsed.success) return response(err(validation('Invalid message query', parsed.error.flatten())));
    let campaignId: string | undefined;
    if (parsed.data.campaignKey !== undefined) {
      campaignId = (await marketing.value.campaigns.list(authenticated.value.tenant.id))
        .find((campaign) => campaign.name === `API: ${parsed.data.campaignKey}`)?.id;
      if (campaignId === undefined) return response(ok({ sends: [], nextCursor: null }));
    }
    return response(ok(await marketing.value.campaignSends.listPage(authenticated.value.tenant.id, {
      ...(campaignId === undefined ? {} : { campaignId }),
      ...(parsed.data.email === undefined ? {} : { email: parsed.data.email }),
      ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
      ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
      limit: parsed.data.limit,
    })));
  });

  app.get('/api/m2m/marketing/messages/:id', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const authenticated = await authenticateMarketingApiKey(c.req.raw.headers, deps);
    if (!authenticated.ok) return response(authenticated);
    const send = await marketing.value.campaignSends.findById(authenticated.value.tenant.id, c.req.param('id'));
    if (send === null) return response(err(appError('not_found', 'Marketing message was not found')));
    const events = await marketing.value.events.listByRef(
      authenticated.value.tenant.id,
      'marketing',
      send.id,
    );
    return response(ok({ ...send, events }));
  });

  app.get('/api/m2m/marketing/consent-definitions', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const authenticated = await authenticateMarketingApiKey(c.req.raw.headers, deps);
    if (!authenticated.ok) return response(authenticated);
    const definitions = await marketing.value.definitions.list(authenticated.value.tenant.id, 'active');
    const discovered = await Promise.all(definitions.map(async (definition) => {
      const versions = await marketing.value.definitions.listVersions(
        authenticated.value.tenant.id,
        definition.id,
      );
      const current = versions.at(-1);
      return {
        id: definition.id,
        key: definition.key,
        kind: definition.kind,
        label: current?.label ?? definition.key,
        doubleOptIn: definition.doubleOptIn,
        documentRef: definition.documentRef,
      };
    }));
    return response(ok({ definitions: discovered }));
  });

  app.get('/api/m2m/marketing/templates', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const authenticated = await authenticateMarketingApiKey(c.req.raw.headers, deps);
    if (!authenticated.ok) return response(authenticated);
    const campaigns = await marketing.value.campaigns.list(authenticated.value.tenant.id);
    return response(ok({
      templates: campaigns
        .filter((campaign) => campaign.status === 'draft' || campaign.status === 'scheduled')
        .map((campaign) => ({ id: campaign.id, name: campaign.name, subject: campaign.subject })),
      layouts: (await marketing.value.layouts.list(authenticated.value.tenant.id))
        .map((layout) => ({ id: layout.id, name: layout.name })),
    }));
  });

  app.post('/api/internal/marketing/tick', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    if (c.req.header('x-marketing-tick-secret') !== marketing.value.tickSecret) return response(err(unauthorized('Invalid marketing tick secret')));
    const parsed = z.object({ tenantId: z.string().min(1), campaignId: z.string().min(1) }).safeParse(await readJson(c.req.raw));
    return parsed.success
      ? response(await marketing.value.dispatchCampaign(parsed.data.tenantId, parsed.data.campaignId, 'manual'))
      : response(err(validation('Invalid marketing tick payload', parsed.error.flatten())));
  });

  app.get('/api/internal/marketing/tick', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const bearer = c.req.header('authorization');
    const authenticated = c.req.header('x-marketing-tick-secret') === marketing.value.tickSecret
      || bearer === `Bearer ${marketing.value.cronSecret}`;
    const trigger = bearer === `Bearer ${marketing.value.cronSecret}` ? 'cron' : 'manual';
    return authenticated
      ? response(await marketing.value.dispatchScheduledMarketing(trigger))
      : response(err(unauthorized('Invalid marketing tick secret')));
  });

};

export const registerPublicMarketingRoutes = (app: Hono<Vars>, deps: AppDeps): void => {
  app.post('/api/webhooks/ses/:webhookToken', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const settings = await marketing.value.sesSettings.findByWebhookToken(c.req.param('webhookToken'));
    if (settings === null) return response(err(appError('not_found', 'Unknown SES webhook')));
    const credentials = await marketing.value.marketingCredentials.resolve(settings.tenantId);
    if (!credentials.ok) return response(credentials);
    const rawBody = await c.req.text();
    const verified = await marketing.value.sns.verify({
      rawBody, headers: Object.fromEntries(c.req.raw.headers.entries()), region: credentials.value.region,
    });
    if (!verified.ok) return response(verified);
    if (verified.value.topicArn !== settings.snsTopicArn) {
      return response(ok({ received: true }));
    }
    if (verified.value.type === 'SubscriptionConfirmation') {
      if (verified.value.subscribeUrl === null) return response(err(validation('SNS confirmation URL is missing')));
      const confirmed = await marketing.value.sns.confirmSubscription({ subscribeUrl: verified.value.subscribeUrl, region: credentials.value.region });
      return confirmed.ok ? response(ok({ received: true })) : response(ok({ received: true }));
    }
    const message: unknown = (() => { try { return JSON.parse(verified.value.message); } catch { return null; } })();
    const applyEvent = async (event: Parameters<typeof applyVerifiedSesEvent>[1]) => {
      const applied = await applyVerifiedSesEvent({
        identity: apiIdentity({ id: settings.tenantId, slug: '', name: '', status: 'active', plan: 'self_hosted', contentVersion: 1 }),
        capabilities: capabilitiesForPrincipal('webhook'),
      }, event, {
        sesSettings: marketing.value.sesSettings, sends: marketing.value.campaignSends,
        events: marketing.value.events, outbox: deps.emailOutbox,
        suppressions: marketing.value.suppressions,
        hmac: marketing.value.hmac, ids: deps.ids, clock: deps.clock,
      });
      if (applied.ok && settings.webhookVerifiedAt === null) {
        await marketing.value.sesSettings.upsert(settings.tenantId, { ...settings, webhookVerifiedAt: deps.clock.nowIso() });
      }
      return response(ok({ received: true }));
    };
    const configurationSetEvent = sesConfigurationSetEventSchema.safeParse(message);
    const delivery = sesDeliveryEventSchema.safeParse(message);
    if (configurationSetEvent.success) {
      const event = configurationSetEvent.data.eventType === 'Open'
        ? {
            kind: 'open' as const, topicArn: verified.value.topicArn,
            messageId: configurationSetEvent.data.mail.messageId, occurredAt: configurationSetEvent.data.open.timestamp,
            raw: message,
          }
        : configurationSetEvent.data.eventType === 'Click'
          ? {
            kind: 'click' as const, topicArn: verified.value.topicArn,
            messageId: configurationSetEvent.data.mail.messageId, occurredAt: configurationSetEvent.data.click.timestamp,
            linkUrl: configurationSetEvent.data.click.link, raw: message,
          }
          : configurationSetEvent.data.eventType === 'Bounce'
            ? {
                kind: 'bounce' as const, topicArn: verified.value.topicArn,
                messageId: configurationSetEvent.data.mail.messageId,
                occurredAt: configurationSetEvent.data.bounce.timestamp,
                bounceType: configurationSetEvent.data.bounce.bounceType,
                status: configurationSetEvent.data.bounce.bouncedRecipients[0]?.status ?? null,
                raw: message,
              }
            : configurationSetEvent.data.eventType === 'Complaint'
              ? {
                  kind: 'complaint' as const, topicArn: verified.value.topicArn,
                  messageId: configurationSetEvent.data.mail.messageId,
                  occurredAt: configurationSetEvent.data.complaint.timestamp, raw: message,
                }
              : {
                  kind: 'delivery' as const, topicArn: verified.value.topicArn,
                  messageId: configurationSetEvent.data.mail.messageId,
                  occurredAt: configurationSetEvent.data.delivery.timestamp, raw: message,
                };
      return applyEvent(event);
    }
    if (!delivery.success) {
      return sesEventDiscriminatorSchema.safeParse(message).success
        ? response(ok({ received: true }))
        : response(err(validation('Malformed SES notification', delivery.error.flatten())));
    }
    const event = delivery.data.notificationType === 'Bounce'
      ? {
          kind: 'bounce' as const, topicArn: verified.value.topicArn, messageId: delivery.data.mail.messageId,
          occurredAt: delivery.data.bounce.timestamp, bounceType: delivery.data.bounce.bounceType,
          status: delivery.data.bounce.bouncedRecipients[0]?.status ?? null, raw: message,
        }
      : delivery.data.notificationType === 'Complaint'
        ? { kind: 'complaint' as const, topicArn: verified.value.topicArn, messageId: delivery.data.mail.messageId, occurredAt: delivery.data.complaint.timestamp, raw: message }
        : { kind: 'delivery' as const, topicArn: verified.value.topicArn, messageId: delivery.data.mail.messageId, occurredAt: delivery.data.delivery.timestamp, raw: message };
    return applyEvent(event);
  });

  app.post('/u/:token', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const resolved = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!resolved.ok || resolved.value === null) return response(resolved.ok ? err(tenantNotFound()) : resolved);
    const result = await unsubscribeOneClick(
      tokenCtx(resolved.value.tenant),
      { token: c.req.param('token') },
      unsubscribeDeps(deps, marketing.value),
    );
    return result.ok ? new Response(null, { status: 200 }) : response(result);
  });

  app.post('/u/:token/confirm', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const resolved = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!resolved.ok || resolved.value === null) return response(resolved.ok ? err(tenantNotFound()) : resolved);
    const token = c.req.param('token');
    const ctx = tokenCtx(resolved.value.tenant);
    const result = await unsubscribeOneClick(ctx, { token }, unsubscribeDeps(deps, marketing.value));
    if (!result.ok) return response(result);
    const preferences = await getUnsubscribePreferences(
      ctx, { token }, unsubscribeDeps(deps, marketing.value),
    );
    if (!preferences.ok) return response(preferences);
    return html(renderPreferenceResultPage({
      nonce: pageNonce(c),
      brand: await publicBrand(deps, resolved.value.tenant),
      language: languageFromRequest(c.req.raw),
      token,
      result: preferences.value.scope === 'all_marketing' ? 'all_unsubscribed' : 'scope_unsubscribed',
      scopeLabel: preferences.value.scopeLabel,
    }));
  });

  app.post('/u/:token/all', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const resolved = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!resolved.ok || resolved.value === null) return response(resolved.ok ? err(tenantNotFound()) : resolved);
    const token = c.req.param('token');
    const result = await unsubscribeAllMarketing(
      tokenCtx(resolved.value.tenant),
      { token },
      unsubscribeDeps(deps, marketing.value),
    );
    if (!result.ok) return response(result);
    return html(renderPreferenceResultPage({
      nonce: pageNonce(c),
      brand: await publicBrand(deps, resolved.value.tenant),
      language: languageFromRequest(c.req.raw),
      token,
      result: 'all_unsubscribed',
      scopeLabel: null,
    }));
  });

  app.post('/u/:token/preferences', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const resolved = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!resolved.ok || resolved.value === null) return response(resolved.ok ? err(tenantNotFound()) : resolved);
    const token = c.req.param('token');
    const form = await c.req.formData();
    const selectedDefinitionIds = form.getAll('consent').filter((value): value is string => typeof value === 'string');
    const result = await saveMarketingConsentPreferences(tokenCtx(resolved.value.tenant), {
      token,
      selectedDefinitionIds,
      evidence: {
        collectedAt: deps.clock.nowIso(),
        proofRef: `preference:${token}`,
        ...(c.req.header('user-agent') === undefined ? {} : { userAgent: c.req.header('user-agent') }),
      },
      confirmationBaseUrl: `${new URL(c.req.url).origin}/marketing/confirm`,
    }, {
      ...unsubscribeDeps(deps, marketing.value),
      confirmations: marketing.value.confirmations,
      outbox: deps.emailOutbox,
      tokens: { nextToken: () => randomBytes(24).toString('base64url') },
    });
    if (!result.ok) return response(result);
    return html(renderPreferenceResultPage({
      nonce: pageNonce(c),
      brand: await publicBrand(deps, resolved.value.tenant),
      language: languageFromRequest(c.req.raw),
      token,
      result: 'saved',
      scopeLabel: null,
      pendingConfirmations: result.value.pendingConfirmations,
    }));
  });

  app.get('/u/:token', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const resolved = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!resolved.ok || resolved.value === null) return response(resolved.ok ? err(tenantNotFound()) : resolved);
    const preferences = await getUnsubscribePreferences(
      tokenCtx(resolved.value.tenant),
      { token: c.req.param('token') },
      unsubscribeDeps(deps, marketing.value),
    );
    if (!preferences.ok) return response(preferences);
    return html(renderPreferencesPage({
      nonce: pageNonce(c),
      brand: await publicBrand(deps, resolved.value.tenant),
      language: languageFromRequest(c.req.raw),
      token: c.req.param('token'),
      ...preferences.value,
    }));
  });

  app.get('/marketing/confirm/:token', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const resolved = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!resolved.ok || resolved.value === null) return response(resolved.ok ? err(tenantNotFound()) : resolved);
    const token = c.req.param('token');
    const confirmation = await marketing.value.confirmations.findByToken(resolved.value.tenant.id, token);
    const state = confirmation === null || (
      confirmation.usedAt === null && Date.parse(confirmation.expiresAt) <= Date.parse(deps.clock.nowIso())
    )
      ? 'expired'
      : confirmation.usedAt === null ? 'prompt' : 'success';
    const path = `/marketing/confirm/${encodeURIComponent(token)}`;
    return html(renderConfirmationPage({
      nonce: pageNonce(c),
      brand: await publicBrand(deps, resolved.value.tenant),
      language: languageFromRequest(c.req.raw),
      path,
      state,
    }));
  });

  app.post('/marketing/confirm/:token', async (c) => {
    const marketing = requireMarketing(deps);
    if (!marketing.ok) return response(marketing);
    const resolved = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!resolved.ok || resolved.value === null) return response(resolved.ok ? err(tenantNotFound()) : resolved);
    const token = c.req.param('token');
    const result = await confirmMarketingConsent(tokenCtx(resolved.value.tenant), {
      token,
      evidence: {
        collectedAt: deps.clock.nowIso(),
        ...(c.req.header('user-agent') === undefined ? {} : { userAgent: c.req.header('user-agent') }),
      },
    }, {
      confirmations: marketing.value.confirmations,
      consents: marketing.value.marketingConsents,
      ids: deps.ids,
      clock: deps.clock,
    });
    const path = `/marketing/confirm/${encodeURIComponent(token)}`;
    return html(renderConfirmationPage({
      nonce: pageNonce(c),
      brand: await publicBrand(deps, resolved.value.tenant),
      language: languageFromRequest(c.req.raw),
      path,
      state: result.ok ? 'success' : 'expired',
    }));
  });

  const legal = async (tenantId: string, slug: string, version?: number) => version === undefined
    ? deps.marketing?.documents.findLatestPublished(tenantId, slug) ?? null
    : deps.marketing?.documents.findPublishedVersion(tenantId, slug, version) ?? null;

  app.get('/legal/:slug', async (c) => {
    const resolved = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!resolved.ok || resolved.value === null) return response(resolved.ok ? err(tenantNotFound()) : resolved);
    const document = await legal(resolved.value.tenant.id, c.req.param('slug'));
    return document === null
      ? response(err(appError('not_found', 'Legal document was not found')))
      : html(renderLegalDocumentPage({
          nonce: pageNonce(c),
          brand: await publicBrand(deps, resolved.value.tenant),
          language: languageFromRequest(c.req.raw),
          path: `/legal/${encodeURIComponent(c.req.param('slug'))}`,
          title: document.document.title,
          content: document.version.content,
          immutableVersion: null,
        }));
  });

  app.get('/legal/:slug/v/:version', async (c) => {
    const resolved = await resolveTenant(c.req.header('host') ?? '', c.req.header(TENANT_HEADER) ?? null, deps);
    if (!resolved.ok || resolved.value === null) return response(resolved.ok ? err(tenantNotFound()) : resolved);
    const parsed = z.coerce.number().int().positive().safeParse(c.req.param('version'));
    if (!parsed.success) return response(err(validation('Invalid document version')));
    const document = await legal(resolved.value.tenant.id, c.req.param('slug'), parsed.data);
    return document === null
      ? response(err(appError('not_found', 'Legal document version was not found')))
      : html(renderLegalDocumentPage({
          nonce: pageNonce(c),
          brand: await publicBrand(deps, resolved.value.tenant),
          language: languageFromRequest(c.req.raw),
          path: `/legal/${encodeURIComponent(c.req.param('slug'))}/v/${String(parsed.data)}`,
          title: document.document.title,
          content: document.version.content,
          immutableVersion: {
            version: document.version.version,
            publishedAt: document.version.publishedAt ?? document.version.createdAt,
          },
        }));
  });
};
