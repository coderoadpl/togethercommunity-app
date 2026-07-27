import { z } from 'zod';

export const ksefEnvironmentSchema = z.enum(['test', 'production']);
export const ksefSubmissionStateSchema = z.enum([
  'queued',
  'session_opened',
  'submitting',
  'processing',
  'succeeded',
  'rejected',
  'numbering_conflict',
]);

export const ksefStatusSchema = z.object({
  code: z.number().int(),
  description: z.string(),
  details: z.array(z.string()).default([]),
  extensions: z.record(z.unknown()).default({}),
});

export const ksefInvoiceDataSchema = z.object({
  environment: ksefEnvironmentSchema,
  schemaSystemCode: z.literal('FA (3)'),
  schemaVersion: z.literal('1-0E'),
  contextNip: z.string(),
  sellerName: z.string(),
  sellerAddress: z.string(),
  p2: z.string(),
  invoiceType: z.literal('VAT'),
  issueDate: z.string(),
  xmlArtifactKey: z.string(),
  xmlByteSize: z.number().int().positive(),
  xmlSha256: z.string().regex(/^[a-f0-9]{64}$/),
  state: ksefSubmissionStateSchema,
  authConfigVersion: z.number().int().positive(),
  sessionReference: z.string().nullable(),
  invoiceReference: z.string().nullable(),
  ksefNumber: z.string().nullable(),
  lastStatusCode: z.number().int().nullable(),
  lastStatusDescription: z.string().nullable(),
  lastStatusDetails: z.array(z.string()),
  lastStatusExtensions: z.record(z.unknown()),
  lastPolledAt: z.string().datetime().nullable(),
  acquisitionAt: z.string().datetime().nullable(),
  invoicingAt: z.string().datetime().nullable(),
  permanentStorageAt: z.string().datetime().nullable(),
  upoArtifactKey: z.string().nullable(),
  upoSha256: z.string().nullable(),
  upoRetrievedAt: z.string().datetime().nullable(),
  originalSessionReference: z.string().nullable(),
  originalKsefNumber: z.string().nullable(),
  lastTransportError: z.string().nullable(),
  retryAt: z.string().datetime().nullable(),
  attempt: z.number().int().nonnegative(),
  correlationChecks: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
});

export type KsefEnvironment = z.infer<typeof ksefEnvironmentSchema>;
export type KsefInvoiceData = z.infer<typeof ksefInvoiceDataSchema>;
export type KsefStatus = z.infer<typeof ksefStatusSchema>;

export interface FiscalArtifact {
  key: string;
  tenantId: string;
  invoiceId: string;
  kind: 'fa3' | 'upo';
  content: string;
  sha256: string;
  byteSize: number;
  createdAt: string;
}
