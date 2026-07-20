import type { ErrorCode } from '@core/domain/index.js';

export const HTTP_STATUS_BY_ERROR_CODE: Record<ErrorCode, number> = {
  unauthorized: 401,
  invalid_credentials: 401,
  forbidden: 403,
  not_found: 404,
  validation: 400,
  conflict: 409,
  tenant_not_found: 404,
  integration_not_configured: 412,
  integration_auth: 502,
  integration_unavailable: 503,
  rate_limited: 429,
  internal: 500,
};

export const EXIT_CODE_BY_ERROR_CODE: Record<ErrorCode, number> = {
  validation: 2,
  unauthorized: 3,
  invalid_credentials: 3,
  forbidden: 4,
  not_found: 5,
  conflict: 6,
  tenant_not_found: 7,
  integration_not_configured: 8,
  integration_auth: 9,
  integration_unavailable: 11,
  rate_limited: 12,
  internal: 10,
};
