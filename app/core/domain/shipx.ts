import { z } from 'zod';

import { appError, validation, type AppError, type ErrorCode } from './errors.js';
import type { StripeMode } from './integration.js';
import { err, ok, type Result } from './result.js';
import type { OrderShipping } from './shipping.js';

export const PARCEL_TEMPLATES = ['small', 'medium', 'large'] as const;

export const parcelTemplateSchema = z.enum(PARCEL_TEMPLATES);

export type ParcelTemplate = z.infer<typeof parcelTemplateSchema>;

export const DEFAULT_PARCEL_TEMPLATE: ParcelTemplate = 'medium';

export const largestParcelTemplate = (templates: readonly ParcelTemplate[]): ParcelTemplate =>
  templates.length === 0
    ? DEFAULT_PARCEL_TEMPLATE
    : templates.reduce((largest, template) =>
      PARCEL_TEMPLATES.indexOf(template) > PARCEL_TEMPLATES.indexOf(largest) ? template : largest);

export const SHIPX_ENVIRONMENTS = ['sandbox', 'production'] as const;

export const shipxEnvironmentSchema = z.enum(SHIPX_ENVIRONMENTS);

export type ShipxEnvironment = z.infer<typeof shipxEnvironmentSchema>;

export const DEFAULT_SHIPX_ENVIRONMENT: ShipxEnvironment = 'sandbox';

export type ShipxClientKind = 'real' | 'fake';

export const shipxClientKind = (environment: ShipxEnvironment, mode: StripeMode): Result<ShipxClientKind, AppError> => {
  if (environment === 'production') return ok(mode === 'live' ? 'real' : 'fake');
  return mode === 'test'
    ? ok('real')
    : err(shipxStateError('validation', 'ShipX is configured for the sandbox; switch to production before shipping paid orders', { state: 'setup_missing', reason: 'sandbox_environment' }));
};

const SHIPX_SERVICES = ['inpost_locker_standard', 'inpost_courier_standard'] as const;

const shipxServiceSchema = z.enum(SHIPX_SERVICES);

export type ShipxService = z.infer<typeof shipxServiceSchema>;

export const shipxServiceFor = (shipping: Pick<OrderShipping, 'carrier' | 'pickupPoint'>): ShipxService | null => {
  if (shipping.carrier !== 'inpost') return null;
  return shipping.pickupPoint === null ? 'inpost_courier_standard' : 'inpost_locker_standard';
};

export const SHIPX_POLL_ATTEMPTS = 10;
export const SHIPX_POLL_INTERVAL_MS = 2000;
export const SHIPX_REQUEST_TIMEOUT_MS = 5000;
export const SHIPX_OPERATION_DEADLINE_MS = 20_000;
export const SHIPX_OPERATION_LEASE_MS = 90_000;
export const SHIPX_RECONCILE_PAGE_SIZE = 50;
export const SHIPX_RECONCILE_MAX_PAGES = 5;
export const SHIPX_COURIER_PARCEL_WEIGHT_KG = 5;

export const SHIPX_PARCEL_DIMENSIONS_MM: Record<ParcelTemplate, { length: number; width: number; height: number }> = {
  small: { length: 640, width: 380, height: 80 },
  medium: { length: 640, width: 380, height: 190 },
  large: { length: 640, width: 380, height: 410 },
};

const SHIPX_PHONE_PATTERN = /^\d{9}$/;

export const normalizeShipxPhone = (raw: string): string | null => {
  const digits = raw.replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('48')
    ? digits.slice(2)
    : digits.length === 13 && digits.startsWith('0048') ? digits.slice(4) : digits;
  return SHIPX_PHONE_PATTERN.test(local) ? local : null;
};

const POST_CODE_PATTERN = /^\d{2}-\d{3}$/;

export const shipxSenderSchema = z.object({
  name: z.string().trim().min(1).max(100),
  company: z.string().trim().min(1).max(100).nullable().default(null),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().refine((phone) => normalizeShipxPhone(phone) !== null, 'Phone must be a Polish 9-digit number'),
  street: z.string().trim().min(1).max(100),
  buildingNumber: z.string().trim().min(1).max(20),
  city: z.string().trim().min(1).max(100),
  postCode: z.string().trim().regex(POST_CODE_PATTERN, 'Post code must look like 00-000'),
});

export type ShipxSender = z.output<typeof shipxSenderSchema>;

const shipxOrganizationIdSchema = z.string().trim().regex(/^\d{1,20}$/, 'Organization id must be a number');

export const configureShipxInputSchema = z.object({
  environment: shipxEnvironmentSchema.optional(),
  sender: shipxSenderSchema.nullable().optional(),
  organizationId: shipxOrganizationIdSchema.optional(),
  token: z.string().trim().min(1).max(4000).optional(),
  clearCredentials: z.literal(true).optional(),
}).strict();

const maskedCredentialSchema = z.object({ maskedPreview: z.string(), updatedAt: z.string() });

export const shipxSettingsViewSchema = z.object({
  environment: shipxEnvironmentSchema,
  sender: shipxSenderSchema.nullable(),
  organizationId: maskedCredentialSchema.nullable(),
  token: maskedCredentialSchema.nullable(),
  configured: z.boolean(),
});

export type ShipxSettingsView = z.infer<typeof shipxSettingsViewSchema>;

export const SHIPX_STATUS_CREATING = 'creating';
export const SHIPX_STATUS_UNCONFIRMED = 'unknown';

export const SHIPX_SHIPMENT_EVENT_TYPES = [
  'attempt_claimed',
  'attempt_marked',
  'shipment_adopted',
  'shipment_created',
  'offer_bought',
  'payment_failed',
  'attempt_released',
  'attempt_discarded',
  'lease_taken_over',
  'label_fetched',
  'status_refreshed',
  'operation_finished',
] as const;

export type ShipxShipmentEventType = (typeof SHIPX_SHIPMENT_EVENT_TYPES)[number];

export type ShipxOperationOutcome = 'bought' | 'pending' | 'unconfirmed' | 'released' | 'lost_lock' | 'failed';

export const shipxShipmentSchema = z.object({
  shipxShipmentId: z.string().min(1).nullable(),
  status: z.string().min(1),
  trackingNumber: z.string().min(1).nullable(),
  environment: shipxEnvironmentSchema,
  createAttemptedAt: z.string().datetime().nullable(),
  boughtAt: z.string().datetime().nullable(),
  labelFetchedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ShipxShipment = z.infer<typeof shipxShipmentSchema>;

export const shipxAttemptUnconfirmed = (shipment: Pick<ShipxShipment, 'shipxShipmentId' | 'createAttemptedAt'>): boolean =>
  shipment.shipxShipmentId === null && shipment.createAttemptedAt !== null;

export const SHIPX_SETUP_GAPS = ['credentials_missing', 'sender_missing', 'sandbox_environment'] as const;

const SHIPX_UNAVAILABLE_REASONS = ['not_inpost', 'not_to_pack', ...SHIPX_SETUP_GAPS] as const;

export const shipxOrderViewSchema = z.object({
  available: z.boolean(),
  reason: z.enum(SHIPX_UNAVAILABLE_REASONS).nullable(),
  service: shipxServiceSchema.nullable(),
  parcelTemplate: parcelTemplateSchema,
  shipment: shipxShipmentSchema.nullable(),
});

export type ShipxOrderView = z.infer<typeof shipxOrderViewSchema>;

const SHIPX_RECEIVER_GAPS = ['phone', 'name', 'building_number', 'locker_code'] as const;

export const shipxErrorStateSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('pending'), shipmentId: z.string().nullable(), status: z.string().nullable() }),
  z.object({ state: z.literal('unconfirmed'), attemptedAt: z.string().optional(), cause: z.string().optional() }),
  z.object({ state: z.literal('lost_lock') }),
  z.object({ state: z.literal('lease_held') }),
  z.object({ state: z.literal('manual_shipped'), trackingNumber: z.string(), shipxShipmentId: z.string() }),
  z.object({ state: z.literal('environment_mismatch'), environment: shipxEnvironmentSchema, settingsEnvironment: shipxEnvironmentSchema }),
  z.object({ state: z.literal('organization_mismatch') }),
  z.object({ state: z.literal('setup_missing'), reason: z.enum(SHIPX_SETUP_GAPS) }),
  z.object({ state: z.literal('receiver_invalid'), field: z.enum(SHIPX_RECEIVER_GAPS) }),
]);

export type ShipxErrorState = z.infer<typeof shipxErrorStateSchema>;

export const shipxStateError = (code: ErrorCode, message: string, state: ShipxErrorState): AppError => appError(code, message, state);

const receiverInvalid = (field: (typeof SHIPX_RECEIVER_GAPS)[number], message: string): AppError =>
  shipxStateError('validation', message, { state: 'receiver_invalid', field });

export const shipxOrderInputSchema = z.object({ orderId: z.string().min(1) }).strict();

export const shipxDiscardOutputSchema = z.object({ discarded: z.literal(true) });

interface ShipxOffer {
  id: string;
  status: string;
  service: string | null;
  unavailabilityReasons?: readonly string[];
}

export interface ShipxRemoteShipment {
  id: string;
  status: string;
  trackingNumber: string | null;
  reference?: string | null;
  offers: ShipxOffer[];
  selectedOffer: ShipxOffer | null;
  transactions: Array<{ status: string }>;
}

const PRE_PURCHASE_STATUSES: ReadonlySet<string> = new Set(['created', 'offers_prepared', 'offer_selected']);

export const shipxShipmentBought = (shipment: Pick<ShipxRemoteShipment, 'status' | 'trackingNumber'>): boolean =>
  shipment.trackingNumber !== null && !PRE_PURCHASE_STATUSES.has(shipment.status);

const paymentRunning = (shipment: ShipxRemoteShipment): boolean =>
  shipment.transactions.some((transaction) => transaction.status === 'initiated' || transaction.status === 'success');

export const shipxFailedTransactions = (shipment: ShipxRemoteShipment): number =>
  shipment.transactions.filter((transaction) => transaction.status === 'failure').length;

export const shipxOfferToBuy = (shipment: ShipxRemoteShipment, service: ShipxService): string | null => {
  if (shipment.status !== 'offers_prepared' && shipment.status !== 'offer_selected') return null;
  if (paymentRunning(shipment)) return null;
  if (shipment.selectedOffer !== null && shipment.selectedOffer.status === 'selected') return shipment.selectedOffer.id;
  return shipment.offers.find((offer) => offer.service === service && offer.status === 'available')?.id ?? null;
};

interface ShipxReceiver {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: { street: string; buildingNumber: string; city: string; postCode: string; countryCode: string } | null;
}

export interface ShipxShipmentRequest {
  reference: string;
  service: ShipxService;
  parcelTemplate: ParcelTemplate;
  targetPoint: string | null;
  receiver: ShipxReceiver;
  sender: ShipxSender;
}

export interface ShipxLabel {
  contentType: string;
  bytes: Uint8Array;
}

export const splitPersonName = (name: string): { firstName: string; lastName: string } => {
  const parts = name.trim().split(/\s+/).filter((part) => part !== '');
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0] ?? '', lastName: parts[0] ?? '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) ?? '' };
};

const MAX_BUILDING_TOKENS = 5;

const isWhitespace = (text: string, at: number): boolean => at < text.length && /\s/u.test(text.charAt(at));

const isDigit = (text: string, at: number): boolean => {
  const char = text.charAt(at);
  return char >= '0' && char <= '9';
};

const isAsciiLetter = (text: string, at: number): boolean => {
  const char = text.charAt(at);
  return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
};

const skipWhitespace = (text: string, from: number): number => {
  let at = from;
  while (isWhitespace(text, at)) at += 1;
  return at;
};

const numberEnd = (text: string, from: number): number | null => {
  let at = from;
  while (isDigit(text, at)) at += 1;
  if (at === from) return null;
  return isAsciiLetter(text, at) ? at + 1 : at;
};

const unitMarkerEnd = (text: string, from: number): number | null => {
  if (text.startsWith('lok', from)) return from + 3;
  return text.charAt(from) === 'm' ? from + 1 : null;
};

const isBuildingNumber = (text: string, from: number): boolean => {
  const house = numberEnd(text, from);
  if (house === null) return false;
  const slash = skipWhitespace(text, house);
  const flat = text.charAt(slash) === '/' ? numberEnd(text, skipWhitespace(text, slash + 1)) : house;
  if (flat === null) return false;
  if (flat === text.length) return true;
  const unit = skipWhitespace(text, flat);
  const marker = unit === flat ? null : unitMarkerEnd(text, unit);
  if (marker === null) return false;
  return numberEnd(text, skipWhitespace(text, text.charAt(marker) === '.' ? marker + 1 : marker)) === text.length;
};

const buildingCandidates = (text: string): Array<{ streetEnd: number; buildingStart: number }> => {
  const candidates: Array<{ streetEnd: number; buildingStart: number }> = [];
  let at = text.length;
  while (candidates.length < MAX_BUILDING_TOKENS) {
    while (at > 0 && !isWhitespace(text, at - 1)) at -= 1;
    if (at === 0) break;
    const buildingStart = at;
    while (at > 0 && isWhitespace(text, at - 1)) at -= 1;
    if (at === 0) break;
    candidates.push({ streetEnd: at, buildingStart });
  }
  return candidates.reverse();
};

const LINE_BREAK_PATTERN = /[\n\r\u2028\u2029]/u;

const splitBuildingNumber = (line: string): { street: string; buildingNumber: string } | null => {
  const found = buildingCandidates(line).find((candidate) => isBuildingNumber(line, candidate.buildingStart));
  if (found === undefined) return null;
  const street = line.slice(0, found.streetEnd);
  return LINE_BREAK_PATTERN.test(street) ? null : { street, buildingNumber: line.slice(found.buildingStart) };
};

export const splitStreetAddress = (line1: string, line2: string | null): { street: string; buildingNumber: string } | null => {
  const line = line1.trim();
  const extra = line2?.trim() ?? '';
  const split = splitBuildingNumber(line);
  if (split !== null) return extra === '' ? split : { ...split, buildingNumber: `${split.buildingNumber} ${extra}` };
  return extra === '' || line === '' ? null : { street: line, buildingNumber: extra };
};

const REFERENCE_MAX_LENGTH = 100;

export const shipxReference = (orderId: string): string => orderId.slice(0, REFERENCE_MAX_LENGTH);

export const buildShipxShipmentRequest = (input: {
  orderId: string;
  memberEmail: string;
  shipping: OrderShipping;
  sender: ShipxSender;
  parcelTemplate: ParcelTemplate;
}): Result<ShipxShipmentRequest, AppError> => {
  const service = shipxServiceFor(input.shipping);
  if (service === null) return err(validation('The order does not use an InPost delivery option'));
  const phone = input.shipping.phone === null ? null : normalizeShipxPhone(input.shipping.phone);
  if (phone === null) return err(receiverInvalid('phone', 'The delivery phone number is not a Polish 9-digit number'));
  const name = splitPersonName(input.shipping.address.name);
  if (name.firstName === '') return err(receiverInvalid('name', 'The delivery name is missing'));
  let address: ShipxReceiver['address'] = null;
  if (service === 'inpost_courier_standard') {
    const street = splitStreetAddress(input.shipping.address.line1, input.shipping.address.line2);
    if (street === null) return err(receiverInvalid('building_number', 'The building number cannot be read from the delivery address'));
    address = {
      ...street,
      city: input.shipping.address.city,
      postCode: input.shipping.address.postalCode,
      countryCode: input.shipping.address.country,
    };
  }
  const targetPoint = service === 'inpost_locker_standard' ? input.shipping.pickupPoint?.code ?? null : null;
  if (service === 'inpost_locker_standard' && targetPoint === null) return err(receiverInvalid('locker_code', 'The parcel locker code is missing'));
  return ok({
    reference: shipxReference(input.orderId),
    service,
    parcelTemplate: input.parcelTemplate,
    targetPoint,
    receiver: { ...name, email: input.memberEmail, phone, address },
    sender: input.sender,
  });
};

export const shipxErrorDetailsSchema = z.object({
  status: z.number().int(),
  error: z.string().nullable(),
  description: z.string().nullable(),
  fields: z.record(z.array(z.string())),
});

export type ShipxErrorDetails = z.infer<typeof shipxErrorDetailsSchema>;

const ERROR_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const FIELD_PATH_PATTERN = /^[A-Za-z0-9_.]{1,100}$/;
const DESCRIPTION_MAX_LENGTH = 300;
const FIELD_LIMIT = 20;
const FIELD_DEPTH_LIMIT = 4;

const shipxErrorBodySchema = z.object({
  error: z.unknown().optional(),
  description: z.unknown().optional(),
  message: z.unknown().optional(),
  details: z.unknown().optional(),
}).passthrough();

const collectFields = (value: unknown, path: string, depth: number, into: Record<string, string[]>): void => {
  if (depth > FIELD_DEPTH_LIMIT || Object.keys(into).length >= FIELD_LIMIT) return;
  if (Array.isArray(value)) {
    const keys = value.filter((entry): entry is string => typeof entry === 'string' && ERROR_KEY_PATTERN.test(entry));
    if (keys.length > 0 && path !== '' && FIELD_PATH_PATTERN.test(path)) into[path] = keys.slice(0, 5);
    value.forEach((entry, index) => {
      if (typeof entry === 'object' && entry !== null) collectFields(entry, path === '' ? String(index) : `${path}.${String(index)}`, depth + 1, into);
    });
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (!FIELD_PATH_PATTERN.test(key)) continue;
    collectFields(entry, path === '' ? key : `${path}.${key}`, depth + 1, into);
  }
};

const cleanDescription = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return cleaned === '' ? null : cleaned.slice(0, DESCRIPTION_MAX_LENGTH);
};

export const sanitizeShipxError = (status: number, body: unknown): ShipxErrorDetails => {
  const parsed = shipxErrorBodySchema.safeParse(body);
  if (!parsed.success) return { status, error: null, description: null, fields: {} };
  const fields: Record<string, string[]> = {};
  collectFields(parsed.data.details, '', 0, fields);
  return {
    status,
    error: typeof parsed.data.error === 'string' && ERROR_KEY_PATTERN.test(parsed.data.error) ? parsed.data.error : null,
    description: cleanDescription(parsed.data.description ?? parsed.data.message),
    fields,
  };
};

const SHIPX_REJECTION_ERRORS = [
  'invalid_action',
  'label_generation_failed',
  'label_template_not_found',
  'validation_failed',
  'offer_expired',
  'offer_unavailable',
  'transaction_failed',
  'resource_not_found',
  'access_forbidden',
  'no_carriers',
  'carrier_unavailable',
] as const;

export const shipxRejectionErrorSchema = z.enum(SHIPX_REJECTION_ERRORS);

export type ShipxRejectionError = z.infer<typeof shipxRejectionErrorSchema>;

const SHIPX_ERROR_MESSAGES: Readonly<Record<ShipxRejectionError, string>> = {
  invalid_action: 'The InPost label is available only after the shipment is paid',
  label_generation_failed: 'InPost could not generate the label',
  label_template_not_found: 'InPost has no label template for this shipment',
  validation_failed: 'InPost rejected the shipment data',
  offer_expired: 'The InPost offer expired before it was paid',
  offer_unavailable: 'The InPost offer can no longer be paid',
  transaction_failed: 'InPost could not charge the shipment; check the funds or the payment method in Manager Paczek',
  resource_not_found: 'InPost did not find the shipment or the organization',
  access_forbidden: 'InPost refused access with the stored token',
  no_carriers: 'The InPost organization has no carrier agreement',
  carrier_unavailable: 'The InPost organization has no agreement for this service',
};

export const shipxRejected = (details: ShipxErrorDetails): AppError => {
  const error = shipxRejectionErrorSchema.safeParse(details.error);
  const known = error.success ? SHIPX_ERROR_MESSAGES[error.data] : undefined;
  const fallback = details.status === 401 ? 'InPost rejected the stored ShipX token' : `InPost rejected the request (HTTP ${String(details.status)})`;
  return appError('shipx_rejected', known ?? fallback, details);
};

export const shipxUnavailable = (message = 'InPost ShipX is unavailable; retry in a moment', details?: unknown): AppError =>
  appError('shipx_unavailable', message, details);

const DEAD_OFFER_ERRORS: Readonly<Record<string, string>> = { unavailable: 'offer_unavailable', expired: 'offer_expired' };

const purchaseRejected = (details: ShipxErrorDetails): AppError => ({ ...shipxRejected(details), details: { ...details, state: 'failed' } });

export const shipxPurchaseFailure = (shipment: ShipxRemoteShipment, service: ShipxService, failuresBefore: number): AppError | null => {
  if (shipxShipmentBought(shipment) || paymentRunning(shipment)) return null;
  if (shipxFailedTransactions(shipment) > failuresBefore) {
    return purchaseRejected({ status: 200, error: 'transaction_failed', description: null, fields: {} });
  }
  if (shipment.status !== 'offers_prepared' && shipment.status !== 'offer_selected') return null;
  if (shipxOfferToBuy(shipment, service) !== null) return null;
  const offer = shipment.offers.find((candidate) => candidate.service === service) ?? null;
  const error = offer === null ? undefined : DEAD_OFFER_ERRORS[offer.status];
  if (offer === null || error === undefined) return null;
  const reasons = (offer.unavailabilityReasons ?? []).map(cleanDescription).filter((reason): reason is string => reason !== null);
  return purchaseRejected({ status: 200, error, description: reasons.length === 0 ? null : reasons.join('; ').slice(0, DESCRIPTION_MAX_LENGTH), fields: {} });
};
