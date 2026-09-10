import { z } from 'zod';

import { normalizeEmail } from './email.js';
import { marketingNameSchema, marketingTagsSchema } from './marketing-contact.js';
import { importActorSchema } from './marketing-directory-event.js';
import { marketingListKeySchema } from './marketing-list.js';

export const MARKETING_IMPORT_LIMITS = { csvBytes: 3 * 1024 * 1024, multipartBytes: 4 * 1024 * 1024, rows: 10_000, chunkRows: 200, chunkBytes: 1024 * 1024, rowBytes: 16 * 1024 } as const;
export const MARKETING_IMPORT_ATTESTATION_VERSION = 'marketing-import-attestation/v1';
export const MARKETING_IMPORT_ATTESTATION_TEXT = 'I confirm that I am authorized to import these contacts and that each contact for whom consent is being recorded gave valid permission for email marketing covered by the selected consent definition. I have included known unsubscribes, complaints, and permanent bounces in the suppression import. This import must not restore withdrawn consent or remove a suppression.';
export const MARKETING_DIRECTORY_ATTESTATION_TEXT = 'I confirm that I am authorized to import this directory data. This import does not assert marketing consent or remove a suppression.';
export const MARKETING_IMPORT_EMAIL_MISSING = 'marketing_import.email_missing';
export const MARKETING_IMPORT_EMAIL_INVALID = 'marketing_import.email_invalid';
const marketingImportDateSchema = z.string().trim().datetime({ offset: true }).transform((value) => new Date(value).toISOString());
const marketingSuppressionReasonSchema = z.enum(['unsubscribe', 'bounce', 'complaint', 'manual']);
const marketingImportAddressSchema = z.preprocess(
  (value) => value ?? '',
  z.string().trim().min(1, MARKETING_IMPORT_EMAIL_MISSING).transform(normalizeEmail).pipe(z.string().email(MARKETING_IMPORT_EMAIL_INVALID)),
);
export const marketingImportRowSchema = z.object({
  email: marketingImportAddressSchema, name: marketingNameSchema.optional(), firstName: marketingNameSchema.optional(), lastName: marketingNameSchema.optional(),
  tags: marketingTagsSchema.optional(), source: z.string().trim().max(120).optional(),
  consentSource: z.string().trim().max(200).optional(), consentAt: marketingImportDateSchema.optional(),
  lists: z.array(marketingListKeySchema).max(50).transform((keys) => [...new Set(keys)]).optional(),
  reason: marketingSuppressionReasonSchema.optional(), at: marketingImportDateSchema.optional(),
}).strict();
export type MarketingImportRow = z.output<typeof marketingImportRowSchema>;
const marketingImportDefaultsSchema = z.object({
  source: z.string().trim().min(1).max(120).optional(), reason: marketingSuppressionReasonSchema.optional(), at: marketingImportDateSchema.optional(),
}).strict();
export const marketingImportFieldSchema = z.enum(['email', 'name', 'firstName', 'lastName', 'tags', 'source', 'consentSource', 'consentAt', 'lists', 'reason', 'at']);
export const marketingImportMappingSchema = z.record(marketingImportFieldSchema).refine((mapping) => new Set(Object.values(mapping)).size === Object.values(mapping).length, 'Duplicate column mappings are not allowed');
export const marketingImportCreateSchema = z.object({
  datasetVersion: z.literal('together-marketing-contacts/v1'), kind: z.enum(['contacts', 'suppressions']),
  fileName: z.string().trim().min(1).max(255), fileSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  rowCount: z.number().int().min(1).max(MARKETING_IMPORT_LIMITS.rows),
  consentDefinitionId: z.string().min(1).nullable().default(null), defaults: marketingImportDefaultsSchema.default({}),
  mapping: marketingImportMappingSchema.default({}), delimiter: z.enum([',', ';']).nullable().default(null),
  idempotencyKey: z.string().min(1).max(200),
}).strict().refine((input) => input.kind !== 'suppressions' || input.consentDefinitionId === null, 'Suppression imports cannot grant consent');
export type MarketingImportCreateInput = z.output<typeof marketingImportCreateSchema>;
export const marketingImportCountsSchema = z.object({
  created: z.number().int().nonnegative().default(0), updated: z.number().int().nonnegative().default(0), unchanged: z.number().int().nonnegative().default(0),
  duplicateRows: z.number().int().nonnegative().default(0), rejectedRows: z.number().int().nonnegative().default(0), linkedMembers: z.number().int().nonnegative().default(0),
  membershipsAdded: z.number().int().nonnegative().default(0), listsCreated: z.number().int().nonnegative().default(0), consentsRecorded: z.number().int().nonnegative().default(0),
  consentsPreserved: z.number().int().nonnegative().default(0), consentBlockedBySuppression: z.number().int().nonnegative().default(0), consentBlockedByWithdrawal: z.number().int().nonnegative().default(0),
  suppressionsCreated: z.number().int().nonnegative().default(0), suppressionsExisting: z.number().int().nonnegative().default(0),
});
export type MarketingImportCounts = z.output<typeof marketingImportCountsSchema>;
const marketingContactImportStatusSchema = z.enum(['draft', 'ready', 'queued', 'processing', 'completed', 'completed_with_errors', 'failed', 'cancelled']);
export const marketingContactImportSchema = z.object({
  id: z.string(), tenantId: z.string(), kind: z.enum(['contacts', 'suppressions']), fileName: z.string(), fileSha256: z.string().nullable(),
  datasetVersion: z.literal('together-marketing-contacts/v1'), mapping: marketingImportMappingSchema, delimiter: z.enum([',', ';']).nullable(), defaults: marketingImportDefaultsSchema,
  contentHash: z.string(), requestHash: z.string(), idempotencyKey: z.string(), rowCount: z.number().int(),
  consentDefinitionId: z.string().nullable(), definitionVersion: z.number().int().nullable(), definitionHash: z.string().nullable(), validationHash: z.string().nullable(),
  attestationVersion: z.string().nullable(), attestationText: z.string().nullable(), attestationLocale: z.literal('en').nullable(), attestationNote: z.string().nullable(),
  attestedBy: importActorSchema.nullable(), attestedAt: z.string().datetime().nullable(), invalidRows: z.enum(['reject_batch', 'skip_invalid']),
  status: marketingContactImportStatusSchema, resultCounts: marketingImportCountsSchema,
  lockedBy: z.string().nullable(), lockedUntil: z.string().datetime().nullable(), attempts: z.number().int(), nextAttemptAt: z.string().datetime(), lastError: z.string().nullable(),
  createdAt: z.string().datetime(), startedAt: z.string().datetime().nullable(), finishedAt: z.string().datetime().nullable(), stagedDataPurgedAt: z.string().datetime().nullable(),
});
export type MarketingContactImport = z.output<typeof marketingContactImportSchema>;
export const marketingImportRowReceiptSchema = z.object({
  tenantId: z.string(), importId: z.string(), rowNumber: z.number().int().positive(), rowHash: z.string(), normalizedEmailHmac: z.string().nullable(),
  stagedPayload: z.record(z.unknown()).nullable(), normalizedPayload: marketingImportRowSchema.nullable(),
  status: z.enum(['staged', 'valid', 'invalid', 'duplicate', 'processed']), duplicateOf: z.number().int().nullable(),
  contactId: z.string().nullable(), consentRowId: z.string().nullable(), suppressionId: z.string().nullable(),
  outcome: z.enum(['created', 'updated', 'unchanged', 'duplicate', 'rejected', 'suppression_created', 'suppression_existing']).nullable(),
  errors: z.array(z.string()), warnings: z.array(z.string()), counts: marketingImportCountsSchema, processedAt: z.string().datetime().nullable(),
});
export type MarketingImportRowReceipt = z.output<typeof marketingImportRowReceiptSchema>;
export const marketingImportAppendSchema = z.object({ importId: z.string().min(1), offset: z.number().int().min(0), rows: z.array(z.record(z.unknown())).min(1).max(200) }).strict();
export const marketingImportCommitSchema = z.object({
  importId: z.string().min(1), validationHash: z.string().min(1),
  attestation: z.object({ accepted: z.literal(true), version: z.literal(MARKETING_IMPORT_ATTESTATION_VERSION), locale: z.literal('en'), note: z.string().trim().min(20).max(2000) }).strict(),
  invalidRows: z.enum(['reject_batch', 'skip_invalid']).default('reject_batch'),
}).strict();
export const marketingImportValidationSchema = z.object({
  headers: z.array(z.string()), canCommitWithSkippedRows: z.boolean(),
  import: marketingContactImportSchema, validationHash: z.string(), preview: z.array(marketingImportRowReceiptSchema).max(20),
  counts: z.object({ validRows: z.number(), rejectedRows: z.number(), duplicateRows: z.number(), listsToCreate: z.array(z.string()) }),
  errors: z.array(z.object({ rowNumber: z.number(), message: z.string() })), warnings: z.array(z.object({ rowNumber: z.number(), message: z.string() })), canCommit: z.boolean(),
});
export type MarketingImportValidation = z.output<typeof marketingImportValidationSchema>;
export const marketingCanonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(marketingCanonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, item]) => `${JSON.stringify(key)}:${marketingCanonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};
export const marketingImportUploadSchema = z.object({
  csv: z.string(),
  metadata: z.object({ kind: z.enum(['contacts', 'suppressions']), datasetVersion: z.literal('together-marketing-contacts/v1'), fileName: z.string().min(1).max(255),
    consentDefinitionId: z.string().nullable().optional(), mapping: marketingImportMappingSchema.optional(), delimiter: z.enum([',', ';']).optional(), defaults: marketingImportDefaultsSchema.optional(), idempotencyKey: z.string().min(1).max(200),
  }).strict(),
}).strict();
export const marketingImportRemapSchema = z.object({ importId: z.string().min(1), mapping: marketingImportMappingSchema.optional(), delimiter: z.enum([',', ';']).optional(), defaults: marketingImportDefaultsSchema.optional(), consentDefinitionId: z.string().nullable().optional() }).strict();
