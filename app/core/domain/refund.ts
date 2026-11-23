import { z } from 'zod';
import { appError, type AppError, type ErrorCode } from './errors.js';

const refundStatusSchema = z.enum(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']);
type RefundStatus = z.infer<typeof refundStatusSchema>;

export const stripeRefundObjectSchema = z.object({
  id: z.string().min(1),
  amount: z.number().int(),
  status: refundStatusSchema.nullable(),
  failure_reason: z.string().nullable().optional(),
  payment_intent: z.union([z.string(), z.object({ id: z.string() })]).nullable().optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
});

export const REFUND_REQUEST_TIMEOUT_MS = 5_000;
export const REFUND_REQUEST_MAX_NETWORK_RETRIES = 0;
// stripe-node repeats a request whose connection was reset (ECONNRESET, EPIPE) once even with no network
// retries, after a 0.5 s pause; any further retry may wait out a Retry-After of up to 60 s.
const STRIPE_RESET_CONNECTION_PAUSE_MS = 500;
export const REFUND_REQUEST_WORST_CASE_MS = 2 * REFUND_REQUEST_TIMEOUT_MS + STRIPE_RESET_CONNECTION_PAUSE_MS;

export interface ProviderRefund {
  refundId: string;
  paymentIntentId: string | null;
  amountCents: number;
  status: RefundStatus | null;
  failureReason: string | null;
  orderId: string | null;
  reason: string | null;
  refundJobId?: string;
}

const refundFailureKindSchema = z.enum([
  'permission_missing',
  'insufficient_balance',
  'not_found',
  'already_refunded',
  'idempotency_mismatch',
  'refund_failed',
  'credentials_unavailable',
  'transient',
]);
export type RefundFailureKind = z.infer<typeof refundFailureKindSchema>;

const REFUND_FAILURE_ERROR_CODE = {
  permission_missing: 'integration_auth',
  insufficient_balance: 'integration_unavailable',
  not_found: 'not_found',
  already_refunded: 'conflict',
  idempotency_mismatch: 'conflict',
  refund_failed: 'validation',
  credentials_unavailable: 'integration_not_configured',
  transient: 'integration_unavailable',
} as const satisfies Record<RefundFailureKind, ErrorCode>;

const refundFailureDetailsSchema = z.object({
  refundFailure: refundFailureKindSchema,
  providerCode: z.string().nullable(),
  outcomeUnknown: z.boolean().default(false),
  providerServerError: z.boolean().default(false),
});

export const refundFailure = (
  kind: RefundFailureKind,
  message: string,
  providerCode: string | null = null,
  outcomeUnknown = false,
  providerServerError = false,
): AppError =>
  appError(REFUND_FAILURE_ERROR_CODE[kind], message, { refundFailure: kind, providerCode, outcomeUnknown, providerServerError });

export const refundFailureOf = (error: AppError): {
  kind: RefundFailureKind;
  providerCode: string | null;
  outcomeUnknown: boolean;
  providerServerError: boolean;
} | null => {
  const parsed = refundFailureDetailsSchema.safeParse(error.details);
  return parsed.success
    ? { kind: parsed.data.refundFailure, providerCode: parsed.data.providerCode, outcomeUnknown: parsed.data.outcomeUnknown, providerServerError: parsed.data.providerServerError }
    : null;
};

const stripeApiFailureSchema = z.object({
  rawType: z.string().optional(),
  code: z.string().optional(),
  statusCode: z.number().optional(),
  message: z.string().optional(),
});

export const stripePermissionMissing = (failure: { statusCode?: number | undefined; code?: string | undefined; message?: string | undefined }): boolean =>
  failure.statusCode === 403 || failure.code === 'permission_denied'
  || (failure.message ?? '').toLowerCase().includes('does not have the required permissions');

const TRANSIENT_STRIPE_CODES: ReadonlySet<string> = new Set(['idempotency_key_in_use', 'lock_timeout', 'rate_limit']);

const stripeRefundFailureKind = (failure: z.infer<typeof stripeApiFailureSchema>): RefundFailureKind => {
  if (stripePermissionMissing(failure)) return 'permission_missing';
  if (failure.code === 'charge_already_refunded') return 'already_refunded';
  if (failure.rawType === 'idempotency_error') return 'idempotency_mismatch';
  if (failure.code === 'balance_insufficient' || failure.code === 'insufficient_funds') return 'insufficient_balance';
  if (failure.code === 'resource_missing' || failure.statusCode === 404) return 'not_found';
  if (failure.code !== undefined && TRANSIENT_STRIPE_CODES.has(failure.code)) return 'transient';
  const status = failure.statusCode;
  if (status === undefined || status === 409 || status === 429 || status >= 500) return 'transient';
  return 'refund_failed';
};

// Without an HTTP status Stripe's answer never arrived, and a 409 idempotency_key_in_use means the
// first request with this key is still executing, so the refund may or may not exist yet.
const stripeOutcomeUnknown = (failure: z.infer<typeof stripeApiFailureSchema>): boolean =>
  failure.statusCode === undefined || failure.code === 'idempotency_key_in_use';

export const stripeRefundFailure = (prefix: string, cause: unknown): AppError => {
  const parsed = stripeApiFailureSchema.safeParse(cause);
  const failure = parsed.success ? parsed.data : {};
  const reason = failure.message ?? (cause instanceof Error ? cause.message : String(cause));
  const serverError = failure.statusCode !== undefined && failure.statusCode >= 500;
  return refundFailure(stripeRefundFailureKind(failure), `${prefix}: ${reason}`, failure.code ?? null, stripeOutcomeUnknown(failure), serverError);
};
