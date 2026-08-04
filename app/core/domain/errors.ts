export const ERROR_CODES = [
  'unauthorized',
  'invalid_credentials',
  'forbidden',
  'banned',
  'not_found',
  'validation',
  'conflict',
  'tenant_not_found',
  'integration_not_configured',
  'integration_auth',
  'integration_unavailable',
  'unavailable',
  'rate_limited',
  'not_consented',
  'suppressed',
  'unsubscribed',
  'pending_confirmation',
  'ses_not_configured',
  'broadcasts_disabled',
  'transactional_platform_cap_reached',
  'slug_reserved',
  'invoice_exemption_basis_missing',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export const appError = (code: ErrorCode, message: string, details?: unknown): AppError =>
  details === undefined ? { code, message } : { code, message, details };

export const unauthorized = (message = 'Authentication required'): AppError =>
  appError('unauthorized', message);

export const invalidCredentials = (message = 'Invalid credentials'): AppError =>
  appError('invalid_credentials', message);

export const forbidden = (message = 'Not allowed'): AppError => appError('forbidden', message);
export const banned = (message = 'This account is suspended in this community'): AppError =>
  appError('banned', message);

export const notFound = (message = 'Not found'): AppError => appError('not_found', message);

export const validation = (message: string, details?: unknown): AppError =>
  appError('validation', message, details);

export const tenantNotFound = (message = 'Unknown tenant'): AppError =>
  appError('tenant_not_found', message);

export const integrationNotConfigured = (
  message = 'Integration is not configured',
  details?: unknown,
): AppError => appError('integration_not_configured', message, details);

export const integrationAuth = (
  message = 'The integration rejected the stored credentials',
  details?: unknown,
): AppError => appError('integration_auth', message, details);

export const integrationUnavailable = (
  message = 'The integration is unreachable',
  details?: unknown,
): AppError => appError('integration_unavailable', message, details);

export const unavailable = (message = 'Service unavailable'): AppError =>
  appError('unavailable', message);

export const rateLimited = (message = 'Too many requests'): AppError =>
  appError('rate_limited', message);

export const slugReserved = (message: string): AppError => appError('slug_reserved', message);

export const internal = (message = 'Internal error'): AppError => appError('internal', message);
