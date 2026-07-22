import {
  campaignCanEditContent,
  emailLayoutSchema,
  err,
  forbidden,
  notFound,
  ok,
  requiresConsentVersionBump,
  tenantSesBroadcastsReady,
  validation,
  type AppError,
  type Campaign,
  type ConsentDefinition,
  type ConsentDocumentRef,
  type ConsentDocumentVersionRef,
  type EmailLayout,
  type Result,
  type TenantDocument,
  type TenantDocumentVersion,
  type TenantSesSettings,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  CampaignRepository,
  Clock,
  ConsentDefinitionRepository,
  EmailLayoutRepository,
  IdGenerator,
  MarketingAudienceRepository,
  TenantDocumentRepository,
  TenantSecretRepository,
  TenantSesSettingsRepository,
  TokenGenerator,
} from '../ports.js';

const staffTenantIdFrom = (ctx: Ctx): Result<string, AppError> =>
  ctx.identity.tenantId === null || ctx.identity.staffRole === null
    ? err(forbidden('Tenant staff access is required'))
    : ok(ctx.identity.tenantId);

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
  const tenantId = staffTenantIdFrom(ctx);
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
  const tenantId = staffTenantIdFrom(ctx);
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
  const tenantId = staffTenantIdFrom(ctx);
  return tenantId.ok ? ok({ documents: await deps.documents.list(tenantId.value) }) : tenantId;
};

export const getTenantDocument = async (
  ctx: Ctx,
  input: { documentId: string },
  deps: { documents: TenantDocumentRepository },
): Promise<Result<{ document: TenantDocument; versions: TenantDocumentVersion[] }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx);
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
  const tenantId = staffTenantIdFrom(ctx);
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
  const tenantId = staffTenantIdFrom(ctx);
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
  const tenantId = staffTenantIdFrom(ctx);
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
  const tenantId = staffTenantIdFrom(ctx);
  return tenantId.ok ? ok({ layouts: await deps.layouts.list(tenantId.value) }) : tenantId;
};

export const saveEmailLayout = async (
  ctx: Ctx,
  input: { layoutId?: string | undefined; name: string; bodyHtml: string },
  deps: { layouts: EmailLayoutRepository; ids: IdGenerator; clock: Clock },
): Promise<Result<{ layout: EmailLayout }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx);
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
  const tenantId = staffTenantIdFrom(ctx);
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
    consentDefinitionId: string;
    productIds: string[];
    layoutId: string | null;
  },
  deps: { campaigns: CampaignRepository; definitions: ConsentDefinitionRepository; layouts: EmailLayoutRepository },
): Promise<Result<{ campaign: Campaign }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx);
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
    bodySource: input.bodyHtml,
    consentDefinitionId: input.consentDefinitionId,
    audienceFilter: input.productIds.length === 0 ? null : { productIds: input.productIds },
    layoutId: input.layoutId,
  });
  return updated === null ? err(notFound('Campaign was not found')) : ok({ campaign: updated });
};

const sesSecretKeys = ['ses.accessKeyId', 'ses.secretAccessKey', 'ses.region'] as const;

const credentialsConfigured = async (tenantId: string, secrets: TenantSecretRepository): Promise<boolean> => {
  const stored = await secrets.listByTenant(tenantId);
  return sesSecretKeys.every((key) => stored.some((secret) => secret.key === key));
};

const broadcastsEnabled = (settings: TenantSesSettings, hasCredentials: boolean): boolean =>
  hasCredentials && tenantSesBroadcastsReady(settings);

export const getTenantSesMarketingSettings = async (
  ctx: Ctx,
  input: { webhookBaseUrl: string },
  deps: { settings: TenantSesSettingsRepository; secrets: TenantSecretRepository },
): Promise<Result<{ settings: TenantSesSettings | null; credentialsConfigured: boolean; webhookUrl: string | null }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const settings = await deps.settings.findByTenant(tenantId.value);
  const hasCredentials = await credentialsConfigured(tenantId.value, deps.secrets);
  if (settings === null) return ok({ settings: null, credentialsConfigured: hasCredentials, webhookUrl: null });
  const derived = { ...settings, broadcastsEnabled: broadcastsEnabled(settings, hasCredentials) };
  return ok({
    settings: derived,
    credentialsConfigured: hasCredentials,
    webhookUrl: `${input.webhookBaseUrl}/${settings.webhookToken}`,
  });
};

export const updateTenantSesMarketingSettings = async (
  ctx: Ctx,
  input: {
    fromAddress: string;
    fromName: string;
    identity: string;
    identityVerified: boolean;
    configurationSet: string | null;
    snsTopicArn: string | null;
    footerLegalName: string;
    footerAddress: string;
  },
  deps: {
    settings: TenantSesSettingsRepository;
    secrets: TenantSecretRepository;
    tokens: TokenGenerator;
    clock: Clock;
    webhookBaseUrl: string;
  },
): Promise<Result<{ settings: TenantSesSettings; credentialsConfigured: boolean; webhookUrl: string }, AppError>> => {
  const tenantId = staffTenantIdFrom(ctx);
  if (!tenantId.ok) return tenantId;
  const current = await deps.settings.findByTenant(tenantId.value);
  const now = deps.clock.nowIso();
  const hasCredentials = await credentialsConfigured(tenantId.value, deps.secrets);
  const settings: TenantSesSettings = {
    tenantId: tenantId.value,
    fromAddress: input.fromAddress,
    fromName: input.fromName,
    identity: input.identity,
    identityVerifiedAt: input.identityVerified ? current?.identityVerifiedAt ?? now : null,
    configurationSet: input.configurationSet,
    snsTopicArn: input.snsTopicArn,
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
  };
  settings.broadcastsEnabled = broadcastsEnabled(settings, hasCredentials);
  const stored = await deps.settings.upsert(tenantId.value, settings);
  return ok({
    settings: stored,
    credentialsConfigured: hasCredentials,
    webhookUrl: `${deps.webhookBaseUrl}/${stored.webhookToken}`,
  });
};
