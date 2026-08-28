import { z } from 'zod';

const importAuditResourceTypeSchema = z.enum([
  'course',
  'module',
  'lesson',
  'product',
  'member',
  'grant',
  'progress',
]);

export type ImportAuditResourceType = z.output<typeof importAuditResourceTypeSchema>;

const importAuditActionSchema = z.enum([
  'created',
  'updated',
  'unchanged',
  'credential_created',
]);

export type ImportAuditAction = z.output<typeof importAuditActionSchema>;

export const importAuditEventSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  apiKeyId: z.string(),
  kind: importAuditResourceTypeSchema,
  importKey: z.string(),
  resourceId: z.string(),
  action: importAuditActionSchema,
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  at: z.string().datetime(),
});

export type ImportAuditEvent = z.infer<typeof importAuditEventSchema>;
