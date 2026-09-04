import { ERROR_CODES, type ErrorCode } from '#core/domain/index.js';

import type { Messages } from './messages.js';

const isErrorCode = (value: string): value is ErrorCode =>
  ERROR_CODES.some((candidate) => candidate === value);

export const errorCodeOf = (error: unknown): ErrorCode | null => {
  if (typeof error !== 'object' || error === null || !('appError' in error)) return null;
  const { appError } = error;
  if (typeof appError !== 'object' || appError === null || !('code' in appError)) return null;
  const { code } = appError;
  return typeof code === 'string' && isErrorCode(code) ? code : null;
};

export const serverMessageOf = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null || !('appError' in error)) return null;
  const { appError } = error;
  if (typeof appError !== 'object' || appError === null || !('message' in appError)) return null;
  const { message } = appError;
  return typeof message === 'string' && message.trim() !== '' ? message : null;
};

const errorDetailOf = (error: unknown, key: string): string | null => {
  if (typeof error !== 'object' || error === null || !('appError' in error)) return null;
  const { appError } = error;
  if (typeof appError !== 'object' || appError === null || !('details' in appError)) return null;
  const { details } = appError;
  if (typeof details !== 'object' || details === null || !(key in details)) return null;
  const value: unknown = Reflect.get(details, key);
  return typeof value === 'string' ? value : null;
};

export const providerCodeOf = (error: unknown): string | null => errorDetailOf(error, 'providerCode');

export const rejectedCorsOriginOf = (error: unknown): string | null =>
  errorDetailOf(error, 'corsOrigin');

export const localizeErrorCode = (code: ErrorCode, t: Messages): string => {
  switch (code) {
    case 'unauthorized':
      return t.errors.messageUnauthorized;
    case 'invalid_credentials':
      return t.errors.messageInvalidCredentials;
    case 'forbidden':
      return t.errors.messageForbidden;
    case 'banned':
      return t.errors.messageBanned;
    case 'impersonation_read_only':
      return t.errors.messageImpersonationReadOnly;
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
      return t.errors.messageEmailSendingNotConfigured;
    case 'transactional_platform_cap_reached':
      return t.errors.messagePlatformEmailPoolExhausted;
    case 'slug_reserved':
      return t.errors.messageSlugReservedGeneric;
    case 'invoice_exemption_basis_missing':
      return t.errors.messageInvoiceExemptionBasisMissing;
    case 'internal':
      return t.errors.messageInternal;
  }
};

const panelHintOf = (code: ErrorCode, t: Messages): string | null => {
  switch (code) {
    case 'integration_not_configured':
      return t.errors.panelHintIntegrationNotConfigured;
    case 'integration_auth':
      return t.errors.panelHintIntegrationAuth;
    case 'ses_not_configured':
    case 'broadcasts_disabled':
      return t.errors.panelHintEmailSendingNotConfigured;
    case 'transactional_platform_cap_reached':
      return t.errors.panelHintPlatformEmailPoolExhausted;
    case 'invoice_exemption_basis_missing':
      return t.errors.panelHintInvoiceExemptionBasisMissing;
    case 'validation':
    case 'unauthorized':
    case 'invalid_credentials':
    case 'forbidden':
    case 'banned':
    case 'not_found':
    case 'conflict':
    case 'tenant_not_found':
    case 'integration_unavailable':
    case 'unavailable':
    case 'rate_limited':
    case 'not_consented':
    case 'suppressed':
    case 'unsubscribed':
    case 'pending_confirmation':
    case 'slug_reserved':
    case 'impersonation_read_only':
    case 'internal':
      return null;
  }
};

export const localizeErrorCodeForPanel = (code: ErrorCode, t: Messages): string => {
  const hint = panelHintOf(code, t);
  const message = localizeErrorCode(code, t);
  return hint === null ? message : `${message} ${hint}`;
};

export const localizeError = (error: unknown, t: Messages): string => {
  const code = errorCodeOf(error);
  return code === null ? t.errors.messageUnknown : localizeErrorCode(code, t);
};

export const localizePanelError = (error: unknown, t: Messages): string => {
  const code = errorCodeOf(error);
  return code === null ? t.errors.messageUnknown : localizeErrorCodeForPanel(code, t);
};
