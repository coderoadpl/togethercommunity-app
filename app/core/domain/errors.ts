import { z } from 'zod';

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
  'impersonation_read_only',
  'shipping_required',
  'locker_phone_invalid',
  'sold_out',
  'fulfilment_conflict',
  'shipx_unavailable',
  'shipx_rejected',
  'feed_cursor_reset',
  'workspace_quota_exceeded',
  'organization_managed',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

const DESCRIBES_THE_REQUEST: Record<ErrorCode, boolean> = {
  unauthorized: false,
  invalid_credentials: false,
  forbidden: false,
  banned: false,
  not_found: true,
  validation: true,
  conflict: true,
  tenant_not_found: false,
  integration_not_configured: false,
  integration_auth: false,
  integration_unavailable: false,
  unavailable: false,
  rate_limited: false,
  not_consented: true,
  suppressed: true,
  unsubscribed: true,
  pending_confirmation: true,
  ses_not_configured: false,
  broadcasts_disabled: false,
  transactional_platform_cap_reached: false,
  slug_reserved: true,
  invoice_exemption_basis_missing: true,
  impersonation_read_only: false,
  shipping_required: true,
  locker_phone_invalid: true,
  sold_out: true,
  fulfilment_conflict: true,
  shipx_unavailable: false,
  shipx_rejected: true,
  feed_cursor_reset: true,
  workspace_quota_exceeded: true,
  organization_managed: true,
  internal: false,
};

/** True for a refusal of the request itself against the current state; false for the caller, the configuration or the infrastructure. */
export const describesTheRequest = (error: Pick<AppError, 'code'>): boolean => DESCRIBES_THE_REQUEST[error.code];

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

export const impersonationReadOnly = (
  message = 'This action is blocked while viewing as a member',
): AppError => appError('impersonation_read_only', message);

export const soldOut = (productTitle: string, productId: string): AppError =>
  appError('sold_out', `"${productTitle}" is sold out`, { productId });

export const internal = (message = 'Internal error'): AppError => appError('internal', message);

export const errorChainEntrySchema = z.object({
  name: z.string().optional(),
  message: z.string(),
  code: z.string().optional(),
  routine: z.string().optional(),
  cause: z.unknown().optional(),
});
