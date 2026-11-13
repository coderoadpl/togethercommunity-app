import { z } from 'zod';
import { DEFAULT_LANGUAGE, languageSchema } from './language.js';
import { productLines, type Order } from './commerce.js';
export { metaCapiCopy } from './meta-capi-settings.js';

const metaCapiConsentSchema = z.enum(['undecided', 'granted', 'denied']);
export const metaCapiStateSchema = z.object({
  consent: metaCapiConsentSchema,
  withdrawnAt: z.string().datetime().nullable(),
});
export type MetaCapiState = z.infer<typeof metaCapiStateSchema>;
export const metaCapiConfigSchema = metaCapiStateSchema.extend({
  enabled: z.boolean(),
  locale: languageSchema.default(DEFAULT_LANGUAGE),
  textVersion: z.string(),
  heading: z.string(),
  body: z.string(),
  acceptLabel: z.string(),
  declineLabel: z.string(),
  privacyUrl: z.string().nullable(),
});
export type MetaCapiConfig = z.infer<typeof metaCapiConfigSchema>;
export const metaCapiDecisionSchema = z.object({
  sessionId: z.string().regex(/^cs_(live|test)_[A-Za-z0-9]{1,200}$/).optional(),
  orderToken: z.string().regex(/^[A-Za-z0-9_-]{22,200}$/).optional(),
  decision: z.enum(['granted', 'denied', 'withdrawn']),
  locale: languageSchema.default(DEFAULT_LANGUAGE),
  textVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  fbp: z.unknown().transform((value) => {
    const parsed = z.string().max(200).regex(/^fb\.1\.\d+\.\d+$/).safeParse(value);
    return parsed.success ? parsed.data : null;
  }).optional(),
}).refine((input) => input.orderToken === undefined || input.decision === 'withdrawn', {
  message: 'Only checkout sessions may record a new decision', path: ['orderToken'],
}).refine((input) => (input.sessionId === undefined) !== (input.orderToken === undefined), 'Provide one order credential').refine((input) => input.decision === 'withdrawn' || input.textVersion !== undefined, {
  message: 'The consent text version is required', path: ['textVersion'],
});
export type MetaCapiDecisionInput = z.input<typeof metaCapiDecisionSchema>;
export const metaCapiWithdrawSchema = z.object({ orderId: z.string().min(1).max(200) });
export const metaCapiEventSchema = z.object({
  tenantId: z.string(), transactionId: z.string(), orderId: z.string(),
  consentAt: z.string().datetime().nullable(), eventTime: z.string().datetime().nullable(),
  sentAt: z.string().datetime().nullable(), recordedAt: z.string().datetime(),
  status: z.enum(['sent', 'blocked', 'expired', 'failed']),
  fbtraceId: z.string().nullable(), error: z.string().nullable(), fieldsSent: z.array(z.string()),
});
export type MetaCapiEvent = z.infer<typeof metaCapiEventSchema>;
export const metaCapiEventsOutputSchema = z.object({ events: z.array(metaCapiEventSchema) });
export const metaCapiConsentsOutputSchema = z.object({ consents: z.array(metaCapiStateSchema.extend({ orderId: z.string(), consentAt: z.string().nullable() })) });
export const metaCapiBlockReason = (order: Order, state: MetaCapiState, enabled: boolean, now: string): 'blocked' | 'expired' | null => {
  if (!enabled || state.consent !== 'granted' || state.withdrawnAt !== null || order.mode !== 'live'
    || order.provider !== 'stripe' || order.providerObjectIds.checkoutSession?.startsWith('cs_live_') !== true
    || order.providerObjectIds.testPurchase === '1' || !['paid', 'partially_refunded', 'refunded'].includes(order.status)) return 'blocked';
  if (!order.paidAt || !Number.isFinite(Date.parse(order.paidAt)) || Date.parse(order.paidAt) > Date.parse(now)) return 'blocked';
  return Date.parse(now) - Date.parse(order.paidAt) >= 7 * 24 * 60 * 60 * 1000 ? 'expired' : null;
};
export const metaCapiRetryAt = (attempt: number, retryable: boolean, now: string): string | null =>
  retryable && attempt >= 1 && attempt <= 3 ? new Date(Date.parse(now) + 60_000 * 2 ** (attempt - 1)).toISOString() : null;

export interface MetaCapiPayload {
  event_name: 'Purchase'; action_source: 'website'; event_time: number; event_id: string; event_source_url: string;
  user_data: { em: string[]; client_ip_address?: string; client_user_agent?: string; fbp?: string; fbc?: string; country?: string[] };
  custom_data: { value: number; currency: string; content_type: 'product'; content_ids: string[]; contents: { id: string; quantity: number; item_price: number }[]; num_items: number; order_id: string };
}
export const buildMetaCapiPayload = (input: {
  order: Order; email: string; sourceUrl: string; ip: string | null; userAgent: string | null; fbp: string | null;
  sha256: (value: string) => string;
}): MetaCapiPayload => {
  const { order, sha256 } = input;
  const lines = order.lines?.length ? productLines(order.lines) : [{ productId: order.productId, grossCents: order.amountCents }];
  const country = order.providerObjectIds.customerCountry;
  return {
    event_name: 'Purchase', action_source: 'website', event_time: Math.floor(Date.parse(order.paidAt ?? '') / 1000),
    event_id: order.id, event_source_url: input.sourceUrl,
    user_data: {
      em: [sha256(input.email.trim().toLowerCase())],
      ...(input.ip ? { client_ip_address: input.ip } : {}),
      ...(input.userAgent ? { client_user_agent: input.userAgent } : {}),
      ...(input.fbp ? { fbp: input.fbp } : {}),
      ...(order.attribution?.fbclid && order.attribution.capturedAt
        ? { fbc: `fb.1.${String(Date.parse(order.attribution.capturedAt))}.${order.attribution.fbclid}` } : {}),
      ...(country && /^[a-z]{2}$/i.test(country) ? { country: [sha256(country.toLowerCase())] } : {}),
    },
    custom_data: {
      value: order.amountCents / 100, currency: order.currency, content_type: 'product',
      content_ids: lines.map((line) => line.productId),
      contents: lines.map((line) => ({ id: line.productId, quantity: 1, item_price: line.grossCents / 100 })),
      num_items: lines.length, order_id: order.id,
    },
  };
};
