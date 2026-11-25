import { ERROR_CODES, STRIPE_ADOPTION_REFUSALS, type ErrorCode, type StripeAdoptionRefusal } from '#core/domain/index.js';

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

export const errorDetailsOf = (error: unknown): unknown => {
  if (typeof error !== 'object' || error === null || !('appError' in error)) return null;
  const { appError } = error;
  if (typeof appError !== 'object' || appError === null || !('details' in appError)) return null;
  return appError.details;
};

const errorDetailOf = (error: unknown, key: string): unknown => {
  const details = errorDetailsOf(error);
  if (typeof details !== 'object' || details === null || !(key in details)) return null;
  return Reflect.get(details, key);
};

const stringDetailOf = (error: unknown, key: string): string | null => {
  const value = errorDetailOf(error, key);
  return typeof value === 'string' ? value : null;
};

export const providerCodeOf = (error: unknown): string | null => stringDetailOf(error, 'providerCode');

const LONGEST_RATE_LIMIT_WINDOW_SECONDS = 600;

export const retryAfterSecondsOf = (error: unknown): number | null => {
  const value = errorDetailOf(error, 'retryAfterSeconds');
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= LONGEST_RATE_LIMIT_WINDOW_SECONDS
    ? value
    : null;
};

export const formatRetryDelay = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
};

const isAdoptionRefusal = (value: string): value is StripeAdoptionRefusal =>
  STRIPE_ADOPTION_REFUSALS.some((candidate) => candidate === value);

export const adoptionRefusalOf = (error: unknown): StripeAdoptionRefusal | null => {
  const refusal = stringDetailOf(error, 'adoptionRefusal');
  return refusal !== null && isAdoptionRefusal(refusal) ? refusal : null;
};

export const rejectedCorsOriginOf = (error: unknown): string | null =>
  stringDetailOf(error, 'corsOrigin');

export const localizeErrorCode = (code: ErrorCode, t: Messages): string => {
  switch (code) {
    case 'unauthorized':
      return t.errors.messageUnauthorized;
    case 'invalid_credentials':
      return t.errors.messageInvalidCredentials;
    case 'forbidden':
    case 'workspace_quota_exceeded':
    case 'organization_managed':
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
    case 'feed_cursor_reset':
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
    case 'shipping_required':
      return t.errors.messageShippingRequired;
    case 'locker_phone_invalid':
      return t.shipping.inpostPhoneInvalid;
    case 'sold_out':
      return t.errors.messageSoldOut;
    case 'delivery_correction_shipped':
      return t.deliveryCorrection.shipped;
    case 'delivery_correction_shipment_exists':
      return t.deliveryCorrection.shipmentExists;
    case 'delivery_correction_member_erased':
      return t.deliveryCorrection.memberErased;
    case 'delivery_correction_conflict':
      return t.deliveryCorrection.conflict;
    case 'delivery_correction_shipment_bought':
      return t.deliveryCorrection.bought;
    case 'fulfilment_conflict':
      return t.errors.messageFulfilmentConflict;
    case 'shipx_unavailable':
      return t.errors.messageShipxUnavailable;
    case 'shipx_rejected':
      return t.errors.messageShipxRejected;
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
    case 'shipping_required':
    case 'locker_phone_invalid':
    case 'sold_out':
    case 'delivery_correction_shipped':
    case 'delivery_correction_shipment_exists':
    case 'delivery_correction_member_erased':
    case 'delivery_correction_conflict':
    case 'delivery_correction_shipment_bought':
    case 'fulfilment_conflict':
    case 'shipx_unavailable':
    case 'shipx_rejected':
    case 'feed_cursor_reset':
    case 'workspace_quota_exceeded':
    case 'organization_managed':
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

export const localizeInvoiceError = (error: unknown, t: Messages): string =>
  stringDetailOf(error, 'invoiceRefusal') === 'order_cancelled_out_of_stock'
    ? t.sales.invoiceOrderCancelledOutOfStock
    : localizePanelError(error, t);
