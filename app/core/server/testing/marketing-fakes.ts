import {
  consumeUnsubscribeToken,
  normalizeEmail,
  ok,
  type AppError,
  type AutomationIdempotencyKey,
  type Campaign,
  type CampaignSend,
  type ConsentConfirmationToken,
  type ConsentDefinition,
  type ConsentDefinitionVersion,
  type EmailLayout,
  type MarketingConsent,
  type Result,
  type Suppression,
  type TenantSesSettings,
  type TenantDocument,
  type TenantDocumentVersion,
  type UnsubscribeToken,
  type EmailOutboxPayload,
} from '@core/domain/index.js';

import type {
  AutomationIdempotencyRepository,
  CampaignRepository,
  CampaignSendRepository,
  ConsentConfirmationTokenRepository,
  ConsentDefinitionRepository,
  EmailLayoutRepository,
  EmailHmac,
  MarketingConsentRepository,
  MarketingAudienceMember,
  MarketingAudienceRepository,
  EmailOutboxItem,
  EmailOutboxRepository,
  SchedulerPort,
  SesMarketingSender,
  SnsVerifier,
  SuppressionRepository,
  TenantSesSettingsRepository,
  TenantDocumentRepository,
  UnsubscribeTokenRepository,
  VerifiedSnsEnvelope,
} from '../ports.js';

const sameTenant = <T extends { tenantId: string }>(tenantId: string, value: T): boolean =>
  value.tenantId === tenantId;

export class InMemoryMarketingConsentRepository implements MarketingConsentRepository {
  private readonly rows: MarketingConsent[] = [];

  async record(tenantId: string, consent: MarketingConsent): Promise<void> {
    if (!sameTenant(tenantId, consent)) throw new Error('Tenant mismatch');
    if (this.rows.some((row) => row.id === consent.id)) throw new Error('Consent repository is append-only');
    this.rows.push(structuredClone(consent));
  }

  async listByEmail(tenantId: string, email: string, definitionId?: string): Promise<MarketingConsent[]> {
    const normalized = normalizeEmail(email);
    return this.rows
      .filter((row) => sameTenant(tenantId, row) && row.email === normalized && (definitionId === undefined || row.definitionId === definitionId))
      .map((row) => structuredClone(row));
  }

  async latestByEmail(tenantId: string, email: string, definitionId: string): Promise<MarketingConsent | null> {
    const rows = await this.listByEmail(tenantId, email, definitionId);
    return rows.reduce<MarketingConsent | null>(
      (latest, row) => latest === null || row.occurredAt >= latest.occurredAt ? row : latest,
      null,
    );
  }

  async findById(tenantId: string, consentId: string): Promise<MarketingConsent | null> {
    const found = this.rows.find((row) => row.tenantId === tenantId && row.id === consentId);
    return found === undefined ? null : structuredClone(found);
  }

  async purgeStalePending(tenantId: string, olderThan: string, doubleOptInDefinitionIds: string[]): Promise<number> {
    const pendingIds = new Set(this.rows
      .filter((row) => row.tenantId === tenantId && row.status === 'granted' && row.occurredAt < olderThan && doubleOptInDefinitionIds.includes(row.definitionId))
      .filter((row) => !this.rows.some((later) => later.tenantId === tenantId && later.previousId === row.id))
      .map((row) => row.id));
    const retained = this.rows.filter((row) => !pendingIds.has(row.id));
    const removed = this.rows.length - retained.length;
    this.rows.splice(0, this.rows.length, ...retained);
    return removed;
  }
}

export class InMemoryConsentConfirmationTokenRepository implements ConsentConfirmationTokenRepository {
  readonly rows: ConsentConfirmationToken[] = [];

  async create(tenantId: string, token: ConsentConfirmationToken): Promise<void> {
    if (!sameTenant(tenantId, token) || this.rows.some((row) => row.token === token.token)) throw new Error('Token already exists');
    this.rows.push(structuredClone(token));
  }

  async findByToken(tenantId: string, token: string): Promise<ConsentConfirmationToken | null> {
    const found = this.rows.find((row) => row.tenantId === tenantId && row.token === token);
    return found === undefined ? null : structuredClone(found);
  }

  async consume(tenantId: string, token: string, usedAt: string): Promise<ConsentConfirmationToken | null> {
    const found = this.rows.find((row) => row.tenantId === tenantId && row.token === token);
    if (found === undefined || found.usedAt !== null || found.expiresAt <= usedAt) return null;
    found.usedAt = usedAt;
    return structuredClone(found);
  }
}

export class InMemoryMarketingAudienceRepository implements MarketingAudienceRepository {
  afterFetch: ((rows: MarketingAudienceMember[]) => Promise<void>) | null = null;

  constructor(private readonly rows: MarketingAudienceMember[] = []) {}

  async snapshot(_tenantId: string, input: { productIds: string[] }): Promise<{ maxMemberId: string | null; count: number }> {
    const rows = this.rows
      .filter((row) => input.productIds.length === 0 || input.productIds.some((id) => row.productIds.includes(id)))
      .sort((left, right) => left.memberId.localeCompare(right.memberId));
    return { maxMemberId: rows.at(-1)?.memberId ?? null, count: rows.length };
  }

  async fetchEligibleBatch(_tenantId: string, input: {
    productIds: string[];
    afterMemberId: string | null;
    maxMemberId: string;
    limit: number;
  }): Promise<MarketingAudienceMember[]> {
    const fetched = this.rows
      .filter((row) => (input.afterMemberId === null || row.memberId > input.afterMemberId) && row.memberId <= input.maxMemberId)
      .filter((row) => input.productIds.length === 0 || input.productIds.some((id) => row.productIds.includes(id)))
      .sort((left, right) => left.memberId.localeCompare(right.memberId))
      .slice(0, input.limit)
      .map((row) => structuredClone(row));
    if (this.afterFetch !== null) await this.afterFetch(fetched);
    return fetched;
  }
}

export class InMemoryConsentDefinitionRepository implements ConsentDefinitionRepository {
  private readonly definitions: ConsentDefinition[] = [];
  private readonly versions: ConsentDefinitionVersion[] = [];

  async create(tenantId: string, definition: ConsentDefinition, version: ConsentDefinitionVersion): Promise<void> {
    if (!sameTenant(tenantId, definition) || !sameTenant(tenantId, version)) throw new Error('Tenant mismatch');
    if (this.definitions.some((row) => row.id === definition.id)) throw new Error('Definition already exists');
    this.definitions.push(structuredClone(definition));
    await this.appendVersion(tenantId, version);
  }

  async findById(tenantId: string, definitionId: string): Promise<ConsentDefinition | null> {
    const found = this.definitions.find((row) => sameTenant(tenantId, row) && row.id === definitionId);
    return found === undefined ? null : structuredClone(found);
  }

  async list(tenantId: string, status?: ConsentDefinition['status']): Promise<ConsentDefinition[]> {
    return this.definitions
      .filter((row) => sameTenant(tenantId, row) && (status === undefined || row.status === status))
      .map((row) => structuredClone(row));
  }

  async update(tenantId: string, definition: ConsentDefinition): Promise<ConsentDefinition | null> {
    const index = this.definitions.findIndex((row) => sameTenant(tenantId, row) && row.id === definition.id);
    if (index < 0 || !sameTenant(tenantId, definition)) return null;
    this.definitions[index] = structuredClone(definition);
    return structuredClone(definition);
  }

  async appendVersion(tenantId: string, version: ConsentDefinitionVersion): Promise<void> {
    if (!sameTenant(tenantId, version)) throw new Error('Tenant mismatch');
    if (this.versions.some((row) => row.id === version.id || (
      row.tenantId === tenantId && row.definitionId === version.definitionId && row.version === version.version
    ))) throw new Error('Definition versions are append-only');
    this.versions.push(structuredClone(version));
  }

  async listVersions(tenantId: string, definitionId: string): Promise<ConsentDefinitionVersion[]> {
    return this.versions
      .filter((row) => sameTenant(tenantId, row) && row.definitionId === definitionId)
      .sort((left, right) => left.version - right.version)
      .map((row) => structuredClone(row));
  }
}

export class InMemoryTenantDocumentRepository implements TenantDocumentRepository {
  private readonly documents: TenantDocument[] = [];
  private readonly versions: TenantDocumentVersion[] = [];

  async create(tenantId: string, document: TenantDocument, draft: TenantDocumentVersion): Promise<void> {
    if (!sameTenant(tenantId, document) || !sameTenant(tenantId, draft) || draft.documentId !== document.id) {
      throw new Error('Tenant document mismatch');
    }
    if (this.documents.some((row) => row.id === document.id || row.tenantId === tenantId && row.slug === document.slug)) {
      throw new Error('Document already exists');
    }
    this.documents.push(structuredClone(document));
    this.versions.push(structuredClone(draft));
  }

  async findById(tenantId: string, documentId: string): Promise<TenantDocument | null> {
    const found = this.documents.find((row) => sameTenant(tenantId, row) && row.id === documentId);
    return found === undefined ? null : structuredClone(found);
  }

  async list(tenantId: string): Promise<TenantDocument[]> {
    return this.documents.filter((row) => sameTenant(tenantId, row)).map((row) => structuredClone(row));
  }

  async listVersions(tenantId: string, documentId: string): Promise<TenantDocumentVersion[]> {
    return this.versions
      .filter((row) => sameTenant(tenantId, row) && row.documentId === documentId)
      .sort((left, right) => left.version - right.version)
      .map((row) => structuredClone(row));
  }

  async saveDraft(tenantId: string, document: TenantDocument, draft: TenantDocumentVersion): Promise<TenantDocumentVersion | null> {
    const documentIndex = this.documents.findIndex((row) => sameTenant(tenantId, row) && row.id === document.id);
    if (documentIndex < 0 || !sameTenant(tenantId, document) || !sameTenant(tenantId, draft)) return null;
    this.documents[documentIndex] = structuredClone(document);
    const draftIndex = this.versions.findIndex((row) =>
      sameTenant(tenantId, row) && row.documentId === document.id && row.publishedAt === null
    );
    if (draftIndex >= 0) {
      const current = this.versions[draftIndex];
      if (current === undefined) return null;
      const updated = { ...current, content: draft.content };
      this.versions[draftIndex] = updated;
      return structuredClone(updated);
    }
    this.versions.push(structuredClone(draft));
    return structuredClone(draft);
  }

  async publishDraft(tenantId: string, documentId: string, publishedAt: string): Promise<{ document: TenantDocument; version: TenantDocumentVersion } | null> {
    const documentIndex = this.documents.findIndex((row) => sameTenant(tenantId, row) && row.id === documentId);
    const versionIndex = this.versions.findIndex((row) =>
      sameTenant(tenantId, row) && row.documentId === documentId && row.publishedAt === null
    );
    const document = this.documents[documentIndex];
    const version = this.versions[versionIndex];
    if (document === undefined || version === undefined) return null;
    const publishedDocument = { ...document, status: 'published' as const, updatedAt: publishedAt };
    const publishedVersion = { ...version, publishedAt };
    this.documents[documentIndex] = publishedDocument;
    this.versions[versionIndex] = publishedVersion;
    return { document: structuredClone(publishedDocument), version: structuredClone(publishedVersion) };
  }

  async findLatestPublished(tenantId: string, slug: string): Promise<{ document: TenantDocument; version: TenantDocumentVersion } | null> {
    const document = this.documents.find((row) => sameTenant(tenantId, row) && row.slug === slug);
    if (document === undefined) return null;
    const published = (await this.listVersions(tenantId, document.id)).filter((version) => version.publishedAt !== null).at(-1);
    return published === undefined ? null : { document: structuredClone(document), version: published };
  }

  async findPublishedVersion(tenantId: string, slug: string, version: number): Promise<{ document: TenantDocument; version: TenantDocumentVersion } | null> {
    const document = this.documents.find((row) => sameTenant(tenantId, row) && row.slug === slug);
    if (document === undefined) return null;
    const found = this.versions.find((row) =>
      sameTenant(tenantId, row) && row.documentId === document.id && row.version === version && row.publishedAt !== null
    );
    return found === undefined ? null : { document: structuredClone(document), version: structuredClone(found) };
  }
}

export class InMemoryCampaignRepository implements CampaignRepository {
  private readonly rows: Campaign[];

  constructor(rows: Campaign[] = []) {
    this.rows = structuredClone(rows);
  }

  async create(tenantId: string, campaign: Campaign): Promise<void> {
    if (!sameTenant(tenantId, campaign)) throw new Error('Tenant mismatch');
    if (this.rows.some((row) => row.id === campaign.id)) throw new Error('Campaign already exists');
    this.rows.push(structuredClone(campaign));
  }

  async findById(tenantId: string, campaignId: string): Promise<Campaign | null> {
    const found = this.rows.find((row) => sameTenant(tenantId, row) && row.id === campaignId);
    return found === undefined ? null : structuredClone(found);
  }

  async list(tenantId: string): Promise<Campaign[]> {
    return this.rows.filter((row) => row.tenantId === tenantId).map((row) => structuredClone(row));
  }

  async delete(tenantId: string, campaignId: string): Promise<boolean> {
    const index = this.rows.findIndex((row) => row.tenantId === tenantId && row.id === campaignId);
    if (index < 0) return false;
    this.rows.splice(index, 1);
    return true;
  }

  async update(tenantId: string, campaign: Campaign): Promise<Campaign | null> {
    const index = this.rows.findIndex((row) => sameTenant(tenantId, row) && row.id === campaign.id);
    if (index < 0 || !sameTenant(tenantId, campaign)) return null;
    this.rows[index] = structuredClone(campaign);
    return structuredClone(campaign);
  }

  async acquireLease(
    tenantId: string,
    campaignId: string,
    input: { workerId: string; now: string; lockedUntil: string },
  ): Promise<boolean> {
    const campaign = this.rows.find((row) => sameTenant(tenantId, row) && row.id === campaignId);
    if (campaign === undefined || (campaign.lockedUntil !== null && campaign.lockedUntil > input.now)) return false;
    campaign.lockedBy = input.workerId;
    campaign.lockedUntil = input.lockedUntil;
    return true;
  }

  async advanceCursor(
    tenantId: string,
    campaignId: string,
    input: { cursorMemberId: string; sentDelta: number; failedDelta: number },
  ): Promise<Campaign | null> {
    const campaign = this.rows.find((row) => sameTenant(tenantId, row) && row.id === campaignId);
    if (campaign === undefined) return null;
    campaign.cursorMemberId = input.cursorMemberId;
    campaign.sent += input.sentDelta;
    campaign.failed += input.failedDelta;
    return structuredClone(campaign);
  }
}

export class InMemoryEmailLayoutRepository implements EmailLayoutRepository {
  private readonly rows: EmailLayout[] = [];

  constructor(rows: EmailLayout[] = []) {
    this.rows = structuredClone(rows);
  }

  async create(tenantId: string, layout: EmailLayout): Promise<void> {
    if (!sameTenant(tenantId, layout) || this.rows.some((row) => row.id === layout.id)) {
      throw new Error('Layout already exists');
    }
    this.rows.push(structuredClone(layout));
  }

  async findById(tenantId: string, layoutId: string): Promise<EmailLayout | null> {
    const found = this.rows.find((row) => sameTenant(tenantId, row) && row.id === layoutId);
    return found === undefined ? null : structuredClone(found);
  }

  async list(tenantId: string): Promise<EmailLayout[]> {
    return this.rows.filter((row) => sameTenant(tenantId, row)).map((row) => structuredClone(row));
  }

  async update(tenantId: string, layout: EmailLayout): Promise<EmailLayout | null> {
    const index = this.rows.findIndex((row) => sameTenant(tenantId, row) && row.id === layout.id);
    if (index < 0 || !sameTenant(tenantId, layout)) return null;
    this.rows[index] = structuredClone(layout);
    return structuredClone(layout);
  }
}

export class InMemoryCampaignSendRepository implements CampaignSendRepository {
  private readonly rows: CampaignSend[] = [];
  afterClaim: ((send: CampaignSend) => Promise<void>) | null = null;
  renderedBodiesAgedOut = 0;

  async claimRecipient(tenantId: string, send: CampaignSend): Promise<boolean> {
    if (!sameTenant(tenantId, send) || this.rows.some((row) => row.id === send.id)) return false;
    if (send.source === 'broadcast' && send.campaignId !== null && this.rows.some((row) =>
      row.source === 'broadcast' &&
      row.tenantId === tenantId && row.campaignId === send.campaignId && row.email === normalizeEmail(send.email)
    )) return false;
    this.rows.push(structuredClone(send));
    if (this.afterClaim !== null) await this.afterClaim(structuredClone(send));
    return true;
  }

  async findById(tenantId: string, sendId: string): Promise<CampaignSend | null> {
    const found = this.rows.find((row) => sameTenant(tenantId, row) && row.id === sendId);
    return found === undefined ? null : structuredClone(found);
  }

  async update(tenantId: string, send: CampaignSend): Promise<CampaignSend | null> {
    const index = this.rows.findIndex((row) => sameTenant(tenantId, row) && row.id === send.id);
    if (index < 0 || !sameTenant(tenantId, send)) return null;
    if (send.sesMessageId !== null && this.rows.some((row, rowIndex) =>
      rowIndex !== index && row.sesMessageId === send.sesMessageId
    )) throw new Error('SES message id must be unique');
    this.rows[index] = structuredClone(send);
    return structuredClone(send);
  }

  async correlateBySesMessageId(tenantId: string, sesMessageId: string): Promise<CampaignSend | null> {
    const found = this.rows.find((row) => sameTenant(tenantId, row) && row.sesMessageId === sesMessageId);
    return found === undefined ? null : structuredClone(found);
  }

  async listByCampaign(tenantId: string, campaignId: string): Promise<CampaignSend[]> {
    return this.rows
      .filter((row) => sameTenant(tenantId, row) && row.campaignId === campaignId)
      .map((row) => structuredClone(row));
  }

  async listAll(tenantId: string): Promise<CampaignSend[]> {
    return this.rows.filter((row) => row.tenantId === tenantId).map((row) => structuredClone(row));
  }

  async listPage(tenantId: string, query: {
    campaignId?: string;
    email?: string;
    status?: CampaignSend['status'];
    cursor?: string;
    limit: number;
  }): Promise<{ sends: CampaignSend[]; nextCursor: string | null }> {
    const rows = this.rows.filter((row) => row.tenantId === tenantId
      && (query.campaignId === undefined || row.campaignId === query.campaignId)
      && (query.email === undefined || row.email === normalizeEmail(query.email))
      && (query.status === undefined || row.status === query.status)
      && (query.cursor === undefined || row.id > query.cursor))
      .sort((left, right) => left.id.localeCompare(right.id));
    return {
      sends: rows.slice(0, query.limit).map((row) => structuredClone(row)),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1]?.id ?? null : null,
    };
  }

  async hasPendingByCampaign(tenantId: string, campaignId: string): Promise<boolean> {
    return this.rows.some((row) => row.tenantId === tenantId && row.campaignId === campaignId && (row.status === 'pending' || row.status === 'sending'));
  }

  async pseudonymizeMember(tenantId: string, input: { memberId: string; email: string; tombstoneEmail: string }): Promise<number> {
    let changed = 0;
    for (const row of this.rows) {
      if (row.tenantId === tenantId && row.memberId === input.memberId && row.email === normalizeEmail(input.email)) {
        row.memberId = null;
        row.email = normalizeEmail(input.tombstoneEmail);
        changed += 1;
      }
    }
    return changed;
  }

  async ageOutRenderedBodies(): Promise<number> {
    return this.renderedBodiesAgedOut;
  }
}

export class InMemorySuppressionRepository implements SuppressionRepository {
  private readonly rows: Suppression[] = [];

  async record(tenantId: string, suppression: Suppression): Promise<boolean> {
    if (!sameTenant(tenantId, suppression)) return false;
    if (this.rows.some((row) => row.tenantId === tenantId && row.emailHmac === suppression.emailHmac && row.liftedAt === null)) return false;
    this.rows.push(structuredClone(suppression));
    return true;
  }

  async findActive(tenantId: string, emailHmac: string): Promise<Suppression | null> {
    const found = this.rows.find((row) => sameTenant(tenantId, row) && row.emailHmac === emailHmac && row.liftedAt === null);
    return found === undefined ? null : structuredClone(found);
  }

  async isSuppressed(tenantId: string, emailHmac: string): Promise<boolean> {
    return (await this.findActive(tenantId, emailHmac)) !== null;
  }

  async lift(tenantId: string, suppression: Suppression): Promise<Suppression | null> {
    const index = this.rows.findIndex((row) => sameTenant(tenantId, row) && row.id === suppression.id);
    if (index < 0 || suppression.reason === 'complaint' || suppression.liftedAt === null || suppression.liftedBy === null) return null;
    this.rows[index] = structuredClone(suppression);
    return structuredClone(suppression);
  }

  async findById(tenantId: string, suppressionId: string): Promise<Suppression | null> {
    const found = this.rows.find((row) => row.tenantId === tenantId && row.id === suppressionId);
    return found === undefined ? null : structuredClone(found);
  }

  async list(tenantId: string, query: { emailHmac?: string; cursor?: string; limit: number }): Promise<{ suppressions: Suppression[]; nextCursor: string | null }> {
    const rows = this.rows.filter((row) => row.tenantId === tenantId
      && (query.emailHmac === undefined || row.emailHmac === query.emailHmac)
      && (query.cursor === undefined || row.id > query.cursor))
      .sort((left, right) => left.id.localeCompare(right.id));
    return {
      suppressions: rows.slice(0, query.limit).map((row) => structuredClone(row)),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1]?.id ?? null : null,
    };
  }
}

export interface InMemoryEmailOutboxItem extends EmailOutboxItem {
  status: 'queued' | 'sending' | 'sent' | 'failed';
}

export class InMemoryEmailOutboxRepository implements EmailOutboxRepository {
  readonly items: InMemoryEmailOutboxItem[] = [];

  async enqueue(input: { id: string; tenantId: string | null; to: string; payload: EmailOutboxPayload }): Promise<Result<{ id: string }, AppError>> {
    this.items.push({ ...structuredClone(input), attempts: 0, status: 'queued' });
    return ok({ id: input.id });
  }

  async claimBatch(input: { limit: number }): Promise<Result<EmailOutboxItem[], AppError>> {
    const claimed = this.items.filter((row) => row.status === 'queued' || row.status === 'failed').slice(0, input.limit);
    claimed.forEach((row) => { row.status = 'sending'; });
    return ok(claimed.map((row) => structuredClone(row)));
  }

  async markSent(input: { id: string }): Promise<Result<void, AppError>> {
    const found = this.items.find((row) => row.id === input.id);
    if (found !== undefined) found.status = 'sent';
    return ok(undefined);
  }

  async markFailed(input: { id: string; attempts: number }): Promise<Result<void, AppError>> {
    const found = this.items.find((row) => row.id === input.id);
    if (found !== undefined) {
      found.status = 'failed';
      found.attempts = input.attempts;
    }
    return ok(undefined);
  }

  async hasPendingForTenant(tenantId: string): Promise<boolean> {
    return this.items.some((row) => row.tenantId === tenantId && (row.status === 'queued' || row.status === 'sending' || row.status === 'failed'));
  }
}

export class InMemoryUnsubscribeTokenRepository implements UnsubscribeTokenRepository {
  private readonly rows: UnsubscribeToken[] = [];

  async create(tenantId: string, token: UnsubscribeToken): Promise<void> {
    if (!sameTenant(tenantId, token)) throw new Error('Tenant mismatch');
    if (this.rows.some((row) => row.id === token.id || row.token === token.token)) throw new Error('Token already exists');
    this.rows.push(structuredClone(token));
  }

  async findByToken(tenantId: string, token: string): Promise<UnsubscribeToken | null> {
    const found = this.rows.find((row) => sameTenant(tenantId, row) && row.token === token);
    return found === undefined ? null : structuredClone(found);
  }

  async consume(tenantId: string, token: string, usedAt: string): Promise<{ token: UnsubscribeToken; newlyUsed: boolean } | null> {
    const index = this.rows.findIndex((row) => sameTenant(tenantId, row) && row.token === token);
    if (index < 0) return null;
    const current = this.rows[index];
    if (current === undefined) return null;
    const consumed = consumeUnsubscribeToken(current, usedAt);
    if (!consumed.ok) return null;
    this.rows[index] = consumed.value.token;
    return { token: structuredClone(consumed.value.token), newlyUsed: consumed.value.newlyUsed };
  }
}

export class InMemoryTenantSesSettingsRepository implements TenantSesSettingsRepository {
  private readonly rows: TenantSesSettings[];

  constructor(rows: TenantSesSettings[] = []) {
    this.rows = structuredClone(rows);
  }

  async findByTenant(tenantId: string): Promise<TenantSesSettings | null> {
    const found = this.rows.find((row) => row.tenantId === tenantId);
    return found === undefined ? null : structuredClone(found);
  }

  async findByWebhookToken(webhookToken: string): Promise<TenantSesSettings | null> {
    const found = this.rows.find((row) => row.webhookToken === webhookToken);
    return found === undefined ? null : structuredClone(found);
  }

  async upsert(tenantId: string, settings: TenantSesSettings): Promise<TenantSesSettings> {
    if (!sameTenant(tenantId, settings)) throw new Error('Tenant mismatch');
    const index = this.rows.findIndex((row) => row.tenantId === tenantId);
    if (index < 0) this.rows.push(structuredClone(settings));
    else this.rows[index] = structuredClone(settings);
    return structuredClone(settings);
  }
}

export interface CapturedMarketingMessage {
  credentials: { accessKeyId: string; secretAccessKey: string; region: string };
  from: { address: string; name: string };
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  configurationSet: string | null;
}

export class FakeSesMarketingSender implements SesMarketingSender {
  readonly sent: CapturedMarketingMessage[] = [];
  result: Result<{ messageId: string }, AppError> = ok({ messageId: 'fake-ses-message' });

  async send(input: CapturedMarketingMessage): Promise<Result<{ messageId: string }, AppError>> {
    this.sent.push(structuredClone(input));
    if (!this.result.ok || this.sent.length === 1) return this.result;
    return ok({ messageId: `${this.result.value.messageId}-${String(this.sent.length)}` });
  }
}

export class FakeSnsVerifier implements SnsVerifier {
  readonly confirmed: Array<{ subscribeUrl: string; region: string }> = [];

  constructor(readonly result: Result<VerifiedSnsEnvelope, AppError>) {}

  async verify(): Promise<Result<VerifiedSnsEnvelope, AppError>> {
    return this.result;
  }

  async confirmSubscription(input: { subscribeUrl: string; region: string }): Promise<Result<void, AppError>> {
    this.confirmed.push(input);
    return ok(undefined);
  }
}

export class FakeScheduler implements SchedulerPort {
  readonly enqueued: Array<{ tenantId: string; campaignId: string }> = [];
  readonly scheduled: Array<{ tenantId: string; campaignId: string; runAt: string }> = [];
  readonly retentionTenants: string[] = [];

  async enqueueCampaignTick(tenantId: string, campaignId: string): Promise<Result<void, AppError>> {
    this.enqueued.push({ tenantId, campaignId });
    return ok(undefined);
  }

  async scheduleCampaignTick(tenantId: string, campaignId: string, runAt: string): Promise<Result<void, AppError>> {
    this.scheduled.push({ tenantId, campaignId, runAt });
    return ok(undefined);
  }

  async enqueueRetentionJobs(tenantId: string): Promise<Result<void, AppError>> {
    this.retentionTenants.push(tenantId);
    return ok(undefined);
  }
}

export class FakeEmailHmac implements EmailHmac {
  compute(tenantId: string, normalizedEmail: string): string {
    return `${tenantId}:${normalizeEmail(normalizedEmail)}`;
  }
}

export class InMemoryAutomationIdempotencyRepository implements AutomationIdempotencyRepository {
  private readonly rows: AutomationIdempotencyKey[] = [];

  async claim(tenantId: string, record: AutomationIdempotencyKey): Promise<AutomationIdempotencyKey | null> {
    if (!sameTenant(tenantId, record)) throw new Error('Tenant mismatch');
    const existing = this.rows.find((row) => row.tenantId === tenantId && row.key === record.key);
    if (existing !== undefined) return structuredClone(existing);
    this.rows.push(structuredClone(record));
    return null;
  }

  async release(tenantId: string, key: string): Promise<void> {
    const index = this.rows.findIndex((row) => row.tenantId === tenantId && row.key === key);
    if (index >= 0) this.rows.splice(index, 1);
  }

  async sweepExpired(now: string): Promise<number> {
    const retained = this.rows.filter((row) => row.expiresAt > now);
    const removed = this.rows.length - retained.length;
    this.rows.splice(0, this.rows.length, ...retained);
    return removed;
  }
}
