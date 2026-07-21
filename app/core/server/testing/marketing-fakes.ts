import {
  consumeUnsubscribeToken,
  normalizeEmail,
  ok,
  type AppError,
  type AutomationIdempotencyKey,
  type Campaign,
  type CampaignSend,
  type ConsentDefinition,
  type ConsentDefinitionVersion,
  type MarketingConsent,
  type Result,
  type Suppression,
  type TenantSesSettings,
  type UnsubscribeToken,
} from '@core/domain/index.js';

import type {
  AutomationIdempotencyRepository,
  CampaignRepository,
  CampaignSendRepository,
  ConsentDefinitionRepository,
  EmailHmac,
  MarketingConsentRepository,
  SchedulerPort,
  SesMarketingSender,
  SnsVerifier,
  SuppressionRepository,
  TenantSesSettingsRepository,
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
      (latest, row) => latest === null || row.occurredAt > latest.occurredAt ? row : latest,
      null,
    );
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

export class InMemoryCampaignSendRepository implements CampaignSendRepository {
  private readonly rows: CampaignSend[] = [];

  async claimRecipient(tenantId: string, send: CampaignSend): Promise<boolean> {
    if (!sameTenant(tenantId, send) || this.rows.some((row) => row.id === send.id)) return false;
    if (send.campaignId !== null && this.rows.some((row) =>
      row.tenantId === tenantId && row.campaignId === send.campaignId && row.email === normalizeEmail(send.email)
    )) return false;
    this.rows.push(structuredClone(send));
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
    return this.result;
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

  async enqueueCampaignTick(tenantId: string, campaignId: string): Promise<Result<void, AppError>> {
    this.enqueued.push({ tenantId, campaignId });
    return ok(undefined);
  }

  async scheduleCampaignTick(tenantId: string, campaignId: string, runAt: string): Promise<Result<void, AppError>> {
    this.scheduled.push({ tenantId, campaignId, runAt });
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
