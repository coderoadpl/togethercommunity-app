import {
  err,
  legalUrlsConfigured,
  ok,
  validation,
  type AppError,
  type ConsentSource,
  type LegalUrls,
  type Result,
  type TenantSettings,
} from '@core/domain/index.js';

import type { Clock, IdGenerator, TenantRepository, TermsConsentRepository } from '../ports.js';

export const tenantLegalUrls = (settings: TenantSettings | null): LegalUrls | null => {
  if (settings === null) return null;
  const legal = { termsUrl: settings.termsUrl, privacyUrl: settings.privacyUrl };
  return legalUrlsConfigured(legal) ? legal : null;
};

export interface EnforceTermsConsentInput {
  accepted: boolean | undefined;
  userId: string | null;
  email: string | null;
  source: ConsentSource;
}

export interface TermsConsentDeps {
  tenants: TenantRepository;
  consents: TermsConsentRepository;
  ids: IdGenerator;
  clock: Clock;
}

export const validateTermsConsent = async (
  tenantId: string,
  accepted: boolean | undefined,
  tenants: TenantRepository,
): Promise<Result<{ required: boolean }, AppError>> => {
  const legal = tenantLegalUrls(await tenants.findSettings(tenantId));
  if (legal === null) return ok({ required: false });
  return accepted === true
    ? ok({ required: true })
    : err(validation('Accepting the terms and privacy policy is required'));
};

/**
 * No-op for tenants without configured legal documents, so dev/demo tenants
 * keep working without any consent plumbing.
 */
export const enforceTermsConsent = async (
  tenantId: string,
  input: EnforceTermsConsentInput,
  deps: TermsConsentDeps,
): Promise<Result<{ recorded: boolean }, AppError>> => {
  const legal = tenantLegalUrls(await deps.tenants.findSettings(tenantId));
  if (legal === null) return ok({ recorded: false });
  if (input.accepted !== true) {
    return err(validation('Accepting the terms and privacy policy is required'));
  }
  await deps.consents.record(tenantId, {
    id: deps.ids.nextId(),
    tenantId,
    userId: input.userId,
    email: input.email,
    source: input.source,
    termsUrl: legal.termsUrl,
    privacyUrl: legal.privacyUrl,
    acceptedAt: deps.clock.nowIso(),
  });
  return ok({ recorded: true });
};
