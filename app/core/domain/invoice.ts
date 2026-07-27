import { z } from 'zod';

export const invoiceStatusSchema = z.enum(['requested', 'issued', 'delivered', 'failed']);

export const invoiceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orderId: z.string(),
  status: invoiceStatusSchema,
  provider: z.string(),
  providerInvoiceId: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  pdfUrl: z.string().url().nullable(),
  error: z.string().nullable(),
  issuedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export type Invoice = z.infer<typeof invoiceSchema>;
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

export const invoiceEventTypeSchema = z.enum([
  'requested',
  'provider_created',
  'issued',
  'delivered',
  'failed',
  'skipped',
  'refreshed',
]);

export const invoiceEventSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  invoiceId: z.string().nullable(),
  orderId: z.string(),
  type: invoiceEventTypeSchema,
  error: z.string().nullable(),
  meta: z.record(z.unknown()),
  occurredAt: z.string().datetime(),
});

export type InvoiceEvent = z.infer<typeof invoiceEventSchema>;
