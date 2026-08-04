import { z } from 'zod';

import { ksefInvoiceDataSchema } from './ksef.js';

const invoiceStatusSchema = z.enum([
  'requested',
  'queued',
  'submitting',
  'processing',
  'issued',
  'delivered',
  'failed',
  'conflict',
]);

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
  ksef: ksefInvoiceDataSchema.nullable().optional(),
});

export type Invoice = z.infer<typeof invoiceSchema>;

const invoiceEventTypeSchema = z.enum([
  'requested',
  'provider_created',
  'issued',
  'delivered',
  'failed',
  'skipped',
  'refreshed',
  'frozen',
  'session_opened',
  'send_started',
  'submitted',
  'correlated',
  'processing',
  'upo_stored',
  'numbering_conflict',
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
