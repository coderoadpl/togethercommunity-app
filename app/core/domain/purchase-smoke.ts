import { z } from 'zod';

export const purchaseSmokeScenarioSchema = z.enum(['digital-course', 'parcel-courier', 'parcel-locker', 'bundle-locker']);
export type PurchaseSmokeScenario = z.infer<typeof purchaseSmokeScenarioSchema>;

export const purchaseSmokeStartSchema = z.object({
  runId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  scenario: purchaseSmokeScenarioSchema,
}).strict();
export type PurchaseSmokeStart = z.infer<typeof purchaseSmokeStartSchema>;

export const purchaseSmokeCheckoutSchema = purchaseSmokeStartSchema.extend({
  reference: z.string().uuid(),
  sessionId: z.string().startsWith('cs_test_'),
  url: z.string().url(),
}).strip();
export type PurchaseSmokeCheckout = z.infer<typeof purchaseSmokeCheckoutSchema>;

export const purchaseSmokeReceiptSchema = z.object({
  eventId: z.string().min(1),
  type: z.enum(['checkout.session.completed', 'charge.refunded']),
  apiVersion: z.string().nullable(),
  appliedAt: z.string().datetime(),
  refundedAmountCents: z.number().int().nonnegative().nullable(),
});
export type PurchaseSmokeReceipt = z.infer<typeof purchaseSmokeReceiptSchema>;

export const purchaseSmokeResultSchema = purchaseSmokeCheckoutSchema.omit({ url: true }).extend({
  paid: z.boolean(),
  refundState: z.enum(['none', 'partial', 'full']),
  refundedAmountCents: z.number().int().nonnegative(),
  receipts: z.array(purchaseSmokeReceiptSchema),
});
export type PurchaseSmokeResult = z.infer<typeof purchaseSmokeResultSchema>;

export const PURCHASE_SMOKE_DAILY_CHECKOUT_LIMIT = 40;
export const PURCHASE_SMOKE_LOCKER_CODE = 'WAW01A';
