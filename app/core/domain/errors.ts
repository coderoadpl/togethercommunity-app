export const ERROR_CODES = [
  'unauthorized',
  'invalid_credentials',
  'forbidden',
  'not_found',
  'validation',
  'conflict',
  'tenant_not_found',
  'integration_not_configured',
  'integration_auth',
  'integration_unavailable',
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

export const notFound = (message = 'Not found'): AppError => appError('not_found', message);

export const validation = (message: string, details?: unknown): AppError =>
  appError('validation', message, details);

export const tenantNotFound = (message = 'Unknown tenant'): AppError =>
  appError('tenant_not_found', message);

export const integrationNotConfigured = (message = 'Integration is not configured'): AppError =>
  appError('integration_not_configured', message);

export const integrationAuth = (message = 'The integration rejected the stored credentials'): AppError =>
  appError('integration_auth', message);

export const integrationUnavailable = (message = 'The integration is unreachable'): AppError =>
  appError('integration_unavailable', message);

export const internal = (message = 'Internal error'): AppError => appError('internal', message);
