import type { AppError, MarketingSignupForm, MarketingSignupFormCounters, Result } from '#core/domain/index.js';

import type { MarketingImportTransactionRepos } from './marketing-contact-ports.js';
import type { Clock, IdGenerator, TokenGenerator, EmailHmac, ConsentConfirmationTokenRepository, EmailOutboxRepository } from './ports.js';

export interface MarketingSignupFormRepository {
  findBySlug(tenantId: string, slug: string): Promise<MarketingSignupForm | null>;
  findBySlugForUpdate(tenantId: string, slug: string): Promise<MarketingSignupForm | null>;
  list(tenantId: string): Promise<MarketingSignupForm[]>;
  save(tenantId: string, form: MarketingSignupForm, expectedRevision: number | null): Promise<Result<MarketingSignupForm, AppError>>;
  counters(tenantId: string, formId: string, now: string): Promise<MarketingSignupFormCounters>;
  recordSubmission(tenantId: string, input: { id: string; formId: string; consentId: string; doubleOptIn: boolean; occurredAt: string }): Promise<void>;
}
export interface MarketingSignupRepos extends MarketingImportTransactionRepos {
  forms: MarketingSignupFormRepository;
  confirmations: ConsentConfirmationTokenRepository;
  outbox: EmailOutboxRepository;
}
export interface MarketingSignupTransaction {
  run<T>(tenantId: string, operation: (repos: MarketingSignupRepos) => Promise<Result<T, AppError>>): Promise<Result<T, AppError>>;
}
export interface MarketingSignupDeps {
  abuseCheck?: (tenantId: string, input: { formId: string; ipHash: string }) => Promise<Result<void, AppError>>;
  forms: MarketingSignupFormRepository;
  transaction: MarketingSignupTransaction;
  clock: Clock;
  ids: IdGenerator;
  tokens: TokenGenerator;
  hmac: EmailHmac;
}
