export interface HtmlToText {
  convert(html: string): string;
}

export interface MarketingWaiter {
  wait(milliseconds: number): Promise<void>;
}

import type { AppError, CampaignSend, EmailEvent, Result } from '#core/domain/index.js';
import type { MarketingOutbox } from '#core/domain/marketing-outbox.js';
import type { MarketingSnsInbox } from '#core/domain/marketing-sns-inbox.js';
import type { CampaignRepository, CampaignSendRepository, EmailEventRepository, EmailOutboxRepository, SuppressionRepository, TenantSesSettingsRepository, UnsubscribeTokenRepository } from './ports.js';

export interface MarketingOutboxRepository {
  enqueue(tenantId: string, row: MarketingOutbox): Promise<void>;
  claim(tenantId: string, input: { workerId: string; now: string; lockedUntil: string }): Promise<MarketingOutbox | null>;
  save(tenantId: string, row: MarketingOutbox): Promise<boolean>;
  recoverExpired(tenantId: string, now: string): Promise<number>;
  listTenantIds(): Promise<string[]>;
  purge(tenantId: string, before: string, now: string): Promise<number>;
  reconcile(tenantId: string, send: CampaignSend, event: EmailEvent): Promise<void>;
}

export interface MarketingSnsInboxRepository {
  record(tenantId: string, row: MarketingSnsInbox): Promise<Result<MarketingSnsInbox, AppError>>;
  claim(tenantId: string, input: { workerId: string; now: string; lockedUntil: string }): Promise<MarketingSnsInbox | null>;
  save(tenantId: string, row: MarketingSnsInbox): Promise<boolean>;
  list(tenantId: string): Promise<MarketingSnsInbox[]>;
  retry(tenantId: string, id: string, now: string, actor: string): Promise<boolean>;
  listTenantIds(): Promise<string[]>;
  purge(tenantId: string, before: string): Promise<number>;
}

export interface MarketingDeliveryRepos {
  marketingOutbox: MarketingOutboxRepository;
  snsInbox: MarketingSnsInboxRepository;
  sends: CampaignSendRepository;
  campaigns: CampaignRepository;
  events: EmailEventRepository;
  suppressions: SuppressionRepository;
  unsubscribes: UnsubscribeTokenRepository;
  sesSettings: TenantSesSettingsRepository;
  outbox: EmailOutboxRepository;
}

export interface MarketingDeliveryTransaction {
  run<T>(tenantId: string, operation: (repos: MarketingDeliveryRepos) => Promise<Result<T, AppError>>): Promise<Result<T, AppError>>;
}
