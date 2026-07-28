import { ERROR_CODES, type ErrorCode } from '#core/domain/index.js';

import type { Messages } from './messages.js';

const isErrorCode = (value: string): value is ErrorCode =>
  ERROR_CODES.some((candidate) => candidate === value);

const errorCodeOf = (error: unknown): ErrorCode | null => {
  if (typeof error !== 'object' || error === null || !('appError' in error)) return null;
  const { appError } = error;
  if (typeof appError !== 'object' || appError === null || !('code' in appError)) return null;
  const { code } = appError;
  return typeof code === 'string' && isErrorCode(code) ? code : null;
};

export const localizeErrorCode = (code: ErrorCode, t: Messages): string => {
  switch (code) {
    case 'unauthorized':
      return t.errors.messageUnauthorized;
    case 'invalid_credentials':
      return t.errors.messageInvalidCredentials;
    case 'forbidden':
      return t.errors.messageForbidden;
    case 'not_found':
      return t.errors.messageNotFound;
    case 'validation':
      return t.errors.messageValidation;
    case 'conflict':
      return t.errors.messageConflict;
    case 'tenant_not_found':
      return t.errors.messageTenantNotFound;
    case 'integration_not_configured':
      return t.errors.messageIntegrationNotConfigured;
    case 'integration_auth':
      return t.errors.messageIntegrationAuth;
    case 'integration_unavailable':
    case 'unavailable':
      return t.errors.messageIntegrationUnavailable;
    case 'rate_limited':
      return t.errors.messageRateLimited;
    case 'not_consented':
    case 'suppressed':
    case 'unsubscribed':
    case 'pending_confirmation':
      return t.errors.messageValidation;
    case 'ses_not_configured':
    case 'broadcasts_disabled':
    case 'transactional_platform_cap_reached':
      return t.errors.messageIntegrationNotConfigured;
    case 'slug_reserved':
      return t.errors.messageSlugReserved({ slug: '…' });
    case 'internal':
      return t.errors.messageInternal;
  }
};

export const localizeError = (error: unknown, t: Messages): string => {
  const code = errorCodeOf(error);
  return code === null ? t.errors.messageUnknown : localizeErrorCode(code, t);
};
