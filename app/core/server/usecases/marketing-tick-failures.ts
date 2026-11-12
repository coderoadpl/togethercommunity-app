import type { AppError, ErrorCode } from '#core/domain/index.js';

type MarketingTickStep = 'sns-inbox' | 'retention' | 'identity' | 'reputation' | 'campaign' | 'outbox';

export interface MarketingTenantError {
  tenantId: string;
  step: MarketingTickStep;
  code: ErrorCode;
  message: string;
}

const TENANT_CONFIGURATION_ERRORS: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['ses_not_configured', 'broadcasts_disabled']);

const isTenantConfigurationError = (error: AppError): boolean => TENANT_CONFIGURATION_ERRORS.has(error.code);

export interface MarketingTickFailures {
  platform(failure: AppError): void;
  tenant(tenantId: string, step: MarketingTickStep, failure: AppError): void;
  firstPlatformFailure(): AppError | null;
  tenantErrors(): MarketingTenantError[];
}

export const createMarketingTickFailures = (logger: {
  warn(message: string): void;
  error(message: string): void;
}): MarketingTickFailures => {
  let first: AppError | null = null;
  const tenants: MarketingTenantError[] = [];
  return {
    platform: (failure) => {
      first ??= failure;
    },
    tenant: (tenantId, step, failure) => {
      if (!isTenantConfigurationError(failure)) {
        logger.error(`[marketing] tick failed tenant=${tenantId} step=${step} error=${failure.code}`);
        first ??= failure;
        return;
      }
      logger.warn(`[marketing] tick skipped tenant=${tenantId} step=${step} error=${failure.code}`);
      tenants.push({ tenantId, step, code: failure.code, message: failure.message });
    },
    firstPlatformFailure: () => first,
    tenantErrors: () => [...tenants],
  };
};
