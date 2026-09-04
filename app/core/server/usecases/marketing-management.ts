import {
  campaignCanEditContent,
  emailLayoutSchema,
  err,
  notFound,
  ok,
  requiresConsentVersionBump,
  tenantSesBroadcastsReady,
  validation,
  type AppError,
  type Capability,
  type Campaign,
  type ConsentDefinition,
  type ConsentDocumentRef,
  type ConsentDocumentVersionRef,
  type EmailLayout,
  type Result,
  type SnsWebhookDelivery,
  type TenantDocument,
  type TenantDocumentVersion,
  type TenantSesSettings,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeRequiredTenant } from '../authorize.js';
import type {
  CampaignRepository,
  Clock,
  ConsentDefinitionRepository,
  EmailLayoutRepository,
  IdGenerator,
  MarketingAudienceRepository,
  MarketingSesCredentialResolver,
  PlatformTransactionalPool,
  SesOnboardingControlPlane,
  SnsWebhookDeliveryRepository,
  TenantDocumentRepository,
  TenantSecretRepository,
  TenantSesSettingsRepository,
  TokenGenerator,
} from '../ports.js';
import { refreshTenantSesIdentityStatus, staleSesWebhookEndpoint } from './marketing-ses-onboarding.js';
import type { SesWebhookBaseUrlResolver } from './ses-webhook-url.js';

const staffTenantIdFrom = (ctx: Ctx, capability: Capability): Result<string, AppError> =>
  authorizeRequiredTenant(ctx, capability);

const documentVersionRef = async (
  tenantId: string,
  documentRef: ConsentDocumentRef,
  documents: TenantDocumentRepository,
): Promise<Result<ConsentDocumentVersionRef, AppError>> => {
  if (documentRef.mode === 'url') return ok(documentRef);
  const versions = await documents.listVersions(tenantId, documentRef.documentId);
  const published = versions.filter((version) => version.publishedAt !== null).at(-1);
  return published === undefined
    ? err(validation('Hosted consent document must be published'))
    : ok({ mode: 'hosted', documentVersionId: published.id });
};

export const getMarketingConsentDefinition = async (
  ctx: Ctx,
  input: { definitionId: string },
  deps: { definitions: ConsentDefinitionRepository },
): Promise<Result<{ definition: ConsentDefinition; versions: Awaited<ReturnType<ConsentDefinitionRepository['listVersions']>> }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:consent-definition:read');
  if (!tenantId.ok) return tenantId;
  const definition = await deps.definitions.findById(tenantId.value, input.definitionId);
  return definition === null
    ? err(notFound('Consent definition was not found'))
    : ok({ definition, versions: await deps.definitions.listVersions(tenantId.value, definition.id) });
};

export const updateMarketingConsentDefinition = async (
  ctx: Ctx,
  input: { definitionId: string; label: string; doubleOptIn: boolean; documentRef: ConsentDocumentRef; status: ConsentDefinition['status'] },
  deps: { definitions: ConsentDefinitionRepository; documents: TenantDocumentRepository; ids: IdGenerator; clock: Clock },
): Promise<Result<{ definition: ConsentDefinition; versions: Awaited<ReturnType<ConsentDefinitionRepository['listVersions']>> }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:consent-definition:write');
  if (!tenantId.ok) return tenantId;
  const definition = await deps.definitions.findById(tenantId.value, input.definitionId);
  if (definition === null) return err(notFound('Consent definition was not found'));
  const versionRef = await documentVersionRef(tenantId.value, input.documentRef, deps.documents);
  if (!versionRef.ok) return versionRef;
  const versions = await deps.definitions.listVersions(tenantId.value, definition.id);
  const latest = versions.at(-1);
  if (latest === undefined) return err(validation('Consent definition has no wording version'));
  const now = deps.clock.nowIso();
  const updated = await deps.definitions.update(tenantId.value, {
    ...definition,
    doubleOptIn: input.doubleOptIn,
    documentRef: input.documentRef,
    status: input.status,
    updatedAt: now,
  });
  if (updated === null) return err(notFound('Consent definition was not found'));
  if (requiresConsentVersionBump(latest, { label: input.label, documentVersionRef: versionRef.value })) {
    await deps.definitions.appendVersion(tenantId.value, {
      id: deps.ids.nextId(),
      tenantId: tenantId.value,
      definitionId: definition.id,
      version: latest.version + 1,
      label: input.label,
      documentVersionRef: versionRef.value,
      createdAt: now,
      createdBy: ctx.identity.userId,
    });
  }
  return ok({ definition: updated, versions: await deps.definitions.listVersions(tenantId.value, definition.id) });
};

export const listTenantDocuments = async (
  ctx: Ctx,
  deps: { documents: TenantDocumentRepository },
): Promise<Result<{ documents: TenantDocument[] }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:document:read');
  return tenantId.ok ? ok({ documents: await deps.documents.list(tenantId.value) }) : tenantId;
};

export const getTenantDocument = async (
  ctx: Ctx,
  input: { documentId: string },
  deps: { documents: TenantDocumentRepository },
): Promise<Result<{ document: TenantDocument; versions: TenantDocumentVersion[] }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:document:read');
  if (!tenantId.ok) return tenantId;
  const document = await deps.documents.findById(tenantId.value, input.documentId);
  return document === null
    ? err(notFound('Hosted document was not found'))
    : ok({ document, versions: await deps.documents.listVersions(tenantId.value, document.id) });
};

export const createTenantDocument = async (
  ctx: Ctx,
  input: { slug: string; title: string; content: string },
  deps: { documents: TenantDocumentRepository; ids: IdGenerator; clock: Clock },
): Promise<Result<{ document: TenantDocument; versions: TenantDocumentVersion[] }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:document:write');
  if (!tenantId.ok) return tenantId;
  const now = deps.clock.nowIso();
  const document: TenantDocument = {
    id: deps.ids.nextId(), tenantId: tenantId.value, slug: input.slug, title: input.title,
    status: 'draft', createdAt: now, updatedAt: now,
  };
  const draft: TenantDocumentVersion = {
    id: deps.ids.nextId(), tenantId: tenantId.value, documentId: document.id, version: 1,
    content: input.content, publishedAt: null, createdAt: now, createdBy: ctx.identity.userId,
  };
  await deps.documents.create(tenantId.value, document, draft);
  return ok({ document, versions: [draft] });
};

export const saveTenantDocumentDraft = async (
  ctx: Ctx,
  input: { documentId: string; title: string; content: string },
  deps: { documents: TenantDocumentRepository; ids: IdGenerator; clock: Clock },
): Promise<Result<{ document: TenantDocument; versions: TenantDocumentVersion[] }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:document:write');
  if (!tenantId.ok) return tenantId;
  const document = await deps.documents.findById(tenantId.value, input.documentId);
  if (document === null) return err(notFound('Hosted document was not found'));
  const versions = await deps.documents.listVersions(tenantId.value, document.id);
  const now = deps.clock.nowIso();
  const saved = await deps.documents.saveDraft(tenantId.value, { ...document, title: input.title, updatedAt: now }, {
    id: deps.ids.nextId(), tenantId: tenantId.value, documentId: document.id,
    version: (versions.at(-1)?.version ?? 0) + 1, content: input.content, publishedAt: null,
    createdAt: now, createdBy: ctx.identity.userId,
  });
  if (saved === null) return err(notFound('Hosted document was not found'));
  const updated = await deps.documents.findById(tenantId.value, document.id);
  return updated === null
    ? err(notFound('Hosted document was not found'))
    : ok({ document: updated, versions: await deps.documents.listVersions(tenantId.value, document.id) });
};

export const publishTenantDocument = async (
  ctx: Ctx,
  input: { documentId: string },
  deps: { documents: TenantDocumentRepository; clock: Clock },
): Promise<Result<{ document: TenantDocument; versions: TenantDocumentVersion[] }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:document:write');
  if (!tenantId.ok) return tenantId;
  const published = await deps.documents.publishDraft(tenantId.value, input.documentId, deps.clock.nowIso());
  return published === null
    ? err(validation('Save a new document draft before publishing'))
    : ok({ document: published.document, versions: await deps.documents.listVersions(tenantId.value, input.documentId) });
};

export const listEmailLayouts = async (
  ctx: Ctx,
  deps: { layouts: EmailLayoutRepository },
): Promise<Result<{ layouts: EmailLayout[] }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:layout:read');
  return tenantId.ok ? ok({ layouts: await deps.layouts.list(tenantId.value) }) : tenantId;
};

export const saveEmailLayout = async (
  ctx: Ctx,
  input: { layoutId?: string | undefined; name: string; bodyHtml: string },
  deps: { layouts: EmailLayoutRepository; ids: IdGenerator; clock: Clock },
): Promise<Result<{ layout: EmailLayout }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:layout:write');
  if (!tenantId.ok) return tenantId;
  const now = deps.clock.nowIso();
  const current = input.layoutId === undefined ? null : await deps.layouts.findById(tenantId.value, input.layoutId);
  if (input.layoutId !== undefined && current === null) return err(notFound('E-mail layout was not found'));
  const parsed = emailLayoutSchema.safeParse({
    id: current?.id ?? deps.ids.nextId(), tenantId: tenantId.value, name: input.name, bodyHtml: input.bodyHtml,
    createdAt: current?.createdAt ?? now, updatedAt: now,
  });
  if (!parsed.success) return err(validation('E-mail layout requires exactly one content slot', parsed.error.flatten()));
  if (current === null) await deps.layouts.create(tenantId.value, parsed.data);
  else if (await deps.layouts.update(tenantId.value, parsed.data) === null) return err(notFound('E-mail layout was not found'));
  return ok({ layout: parsed.data });
};

export const previewMarketingAudience = async (
  ctx: Ctx,
  input: { consentDefinitionId: string; productIds: string[] },
  deps: { definitions: ConsentDefinitionRepository; audience: MarketingAudienceRepository },
): Promise<Result<{ count: number }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:campaign:read');
  if (!tenantId.ok) return tenantId;
  const definition = await deps.definitions.findById(tenantId.value, input.consentDefinitionId);
  if (definition === null || definition.status !== 'active' || definition.kind !== 'optional_marketing') {
    return err(validation('An active marketing consent definition is required'));
  }
  const snapshot = await deps.audience.snapshot(tenantId.value, {
    definitionId: definition.id, productIds: input.productIds,
  });
  return ok({ count: snapshot.count });
};

export const updateMarketingCampaign = async (
  ctx: Ctx,
  input: {
    campaignId: string;
    name: string;
    subject: string;
    bodyHtml: string;
    bodySource?: string | undefined;
    consentDefinitionId: string;
    productIds: string[];
    layoutId: string | null;
  },
  deps: { campaigns: CampaignRepository; definitions: ConsentDefinitionRepository; layouts: EmailLayoutRepository },
): Promise<Result<{ campaign: Campaign }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:campaign:write');
  if (!tenantId.ok) return tenantId;
  const campaign = await deps.campaigns.findById(tenantId.value, input.campaignId);
  if (campaign === null) return err(notFound('Campaign was not found'));
  if (!campaignCanEditContent(campaign.status)) return err(validation('Campaign content is locked in this state'));
  const definition = await deps.definitions.findById(tenantId.value, input.consentDefinitionId);
  if (definition === null || definition.status !== 'active' || definition.kind !== 'optional_marketing') {
    return err(validation('An active marketing consent definition is required'));
  }
  if (input.layoutId !== null && await deps.layouts.findById(tenantId.value, input.layoutId) === null) {
    return err(validation('E-mail layout was not found'));
  }
  const updated = await deps.campaigns.update(tenantId.value, {
    ...campaign,
    name: input.name,
    subject: input.subject,
    bodyHtml: input.bodyHtml,
    bodySource: input.bodySource ?? input.bodyHtml,
    consentDefinitionId: input.consentDefinitionId,
    audienceFilter: input.productIds.length === 0 ? null : { productIds: input.productIds },
    layoutId: input.layoutId,
  });
  return updated === null ? err(notFound('Campaign was not found')) : ok({ campaign: updated });
};

const sesSecretKeys = ['ses.accessKeyId', 'ses.secretAccessKey', 'ses.region'] as const;
const smtpSecretKeys = ['smtp.host', 'smtp.port', 'smtp.user', 'smtp.password', 'smtp.secure'] as const;
const resendSecretKeys = ['resend.apiKey'] as const;

const hasSecrets = (stored: readonly { key: string }[], keys: readonly string[]): boolean =>
  keys.every((key) => stored.some((secret) => secret.key === key));

const senderIdentityConfigured = (settings: TenantSesSettings | null): boolean =>
  settings !== null && settings.fromName.trim() !== '' && settings.fromAddress.trim() !== '';

const broadcastsEnabled = (settings: TenantSesSettings, hasCredentials: boolean): boolean =>
  hasCredentials && tenantSesBroadcastsReady(settings);

export interface SesIdentityCheckDeps {
  credentials: MarketingSesCredentialResolver;
  controlPlane: SesOnboardingControlPlane;
}

const checkSesIdentityAfterSave = async (
  tenantId: string,
  settings: TenantSesSettings,
  hasCredentials: boolean,
  deps: {
    settings: TenantSesSettingsRepository;
    clock: Clock;
    webhookBaseUrl: SesWebhookBaseUrlResolver;
    sesOnboarding?: SesIdentityCheckDeps;
  },
): Promise<TenantSesSettings> => {
  const sesOnboarding = deps.sesOnboarding;
  if (sesOnboarding === undefined || !hasCredentials || settings.identity.trim() === '') return settings;
  try {
    return await refreshTenantSesIdentityStatus(tenantId, settings, {
      settings: deps.settings,
      credentials: sesOnboarding.credentials,
      controlPlane: sesOnboarding.controlPlane,
      clock: deps.clock,
      webhookBaseUrl: deps.webhookBaseUrl,
    });
  } catch {
    return settings;
  }
};

interface TenantSendingSettingsOutput {
  settings: TenantSesSettings | null;
  credentialsConfigured: boolean;
  smtpConfigured: boolean;
  resendConfigured: boolean;
  platformPool: { used: number; limit: 1000 };
  webhookUrl: string | null;
  webhookEndpointStale: boolean;
  lastSnsDelivery: SnsWebhookDelivery | null;
}

export const getTenantSesMarketingSettings = async (
  ctx: Ctx,
  input: { webhookBaseUrl: SesWebhookBaseUrlResolver },
  deps: {
    settings: TenantSesSettingsRepository;
    secrets: TenantSecretRepository;
    pool: PlatformTransactionalPool;
    snsDeliveries: SnsWebhookDeliveryRepository;
  },
): Promise<Result<TenantSendingSettingsOutput, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:ses:read');
  if (!tenantId.ok) return tenantId;
  const [settings, storedSecrets, usage, lastSnsDelivery] = await Promise.all([
    deps.settings.findByTenant(tenantId.value),
    deps.secrets.listByTenant(tenantId.value),
    deps.pool.usage(tenantId.value),
    deps.snsDeliveries.findByTenant(tenantId.value),
  ]);
  const hasCredentials = hasSecrets(storedSecrets, sesSecretKeys);
  const hasSenderIdentity = senderIdentityConfigured(settings);
  const transport = {
    credentialsConfigured: hasCredentials,
    smtpConfigured: hasSenderIdentity && hasSecrets(storedSecrets, smtpSecretKeys),
    resendConfigured: hasSenderIdentity && hasSecrets(storedSecrets, resendSecretKeys),
    platformPool: { used: usage.sent, limit: 1000 as const },
    lastSnsDelivery,
  };
  if (settings === null) {
    return ok({ settings: null, ...transport, webhookUrl: null, webhookEndpointStale: false });
  }
  const derived = { ...settings, broadcastsEnabled: broadcastsEnabled(settings, hasCredentials) };
  const webhookUrl = `${await input.webhookBaseUrl(tenantId.value)}/${settings.webhookToken}`;
  return ok({
    settings: derived,
    ...transport,
    webhookUrl,
    webhookEndpointStale: staleSesWebhookEndpoint(settings, webhookUrl) !== null,
  });
};

export const updateTenantSesMarketingSettings = async (
  ctx: Ctx,
  input: {
    fromAddress: string;
    fromName: string;
    identity: string;
    configurationSet: string | null;
    snsTopicArn: string | null;
    trackingEnabled: boolean;
    autoPauseOnCritical: boolean;
    footerLegalName: string;
    footerAddress: string;
  },
  deps: {
    settings: TenantSesSettingsRepository;
    secrets: TenantSecretRepository;
    tokens: TokenGenerator;
    clock: Clock;
    webhookBaseUrl: SesWebhookBaseUrlResolver;
    pool: PlatformTransactionalPool;
    snsDeliveries: SnsWebhookDeliveryRepository;
    sesOnboarding?: SesIdentityCheckDeps;
  },
): Promise<Result<TenantSendingSettingsOutput, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx, 'marketing:ses:write');
  if (!tenantId.ok) return tenantId;
  if (input.trackingEnabled && input.configurationSet === null) {
    return err(validation('Open and click tracking requires an SES configuration set'));
  }
  const [current, storedSecrets, usage, lastSnsDelivery] = await Promise.all([
    deps.settings.findByTenant(tenantId.value),
    deps.secrets.listByTenant(tenantId.value),
    deps.pool.usage(tenantId.value),
    deps.snsDeliveries.findByTenant(tenantId.value),
  ]);
  const hasCredentials = hasSecrets(storedSecrets, sesSecretKeys);
  const settings: TenantSesSettings = {
    tenantId: tenantId.value,
    fromAddress: input.fromAddress,
    fromName: input.fromName,
    identity: input.identity,
    identityVerifiedAt:
      current?.identity === input.identity ? current.identityVerifiedAt : null,
    identityCheckedAt:
      current?.identity === input.identity ? current.identityCheckedAt : null,
    identityCheckError:
      current?.identity === input.identity ? current.identityCheckError : null,
    configurationSet: input.configurationSet,
    snsTopicArn: input.snsTopicArn,
    snsSubscriptionEndpoint:
      current?.snsTopicArn === input.snsTopicArn ? current.snsSubscriptionEndpoint : null,
    snsSubscriptionConfirmedAt:
      current?.snsTopicArn === input.snsTopicArn ? current.snsSubscriptionConfirmedAt : null,
    trackingEnabled: input.trackingEnabled,
    autoPauseOnCritical: input.autoPauseOnCritical,
    webhookToken: current?.webhookToken ?? deps.tokens.nextToken(),
    quotaRatePerSec: current?.quotaRatePerSec ?? 0,
    quotaDaily: current?.quotaDaily ?? 0,
    quotaSentLast24Hours: current?.quotaSentLast24Hours ?? 0,
    quotaRefreshedAt: current?.quotaRefreshedAt ?? null,
    inSandbox: current?.inSandbox ?? true,
    webhookVerifiedAt: current?.webhookVerifiedAt ?? null,
    footerLegalName: input.footerLegalName,
    footerAddress: input.footerAddress,
    broadcastsEnabled: false,
    reputationAlertStatus: current?.reputationAlertStatus ?? null,
    reputationAlertedAt: current?.reputationAlertedAt ?? null,
  };
  settings.broadcastsEnabled = broadcastsEnabled(settings, hasCredentials);
  const stored = await checkSesIdentityAfterSave(
    tenantId.value,
    await deps.settings.upsert(tenantId.value, settings),
    hasCredentials,
    deps,
  );
  const hasSenderIdentity = senderIdentityConfigured(stored);
  const webhookUrl = `${await deps.webhookBaseUrl(tenantId.value)}/${stored.webhookToken}`;
  return ok({
    settings: stored,
    credentialsConfigured: hasCredentials,
    smtpConfigured: hasSenderIdentity && hasSecrets(storedSecrets, smtpSecretKeys),
    resendConfigured: hasSenderIdentity && hasSecrets(storedSecrets, resendSecretKeys),
    platformPool: { used: usage.sent, limit: 1000 as const },
    webhookUrl,
    webhookEndpointStale: staleSesWebhookEndpoint(stored, webhookUrl) !== null,
    lastSnsDelivery,
  });
};
