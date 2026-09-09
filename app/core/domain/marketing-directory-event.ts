import { z } from 'zod';

export const importActorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('api_key'), apiKeyId: z.string().min(1) }).strict(),
]);
export type ImportActor = z.output<typeof importActorSchema>;
export const marketingDirectoryEventSchema = z.object({
  id: z.string().min(1), tenantId: z.string().min(1),
  subjectKind: z.enum(['contact', 'list', 'membership', 'import']), subjectId: z.string().min(1),
  sequence: z.number().int().positive(), type: z.enum([
    'contact_created', 'contact_updated', 'contact_archived', 'contact_restored', 'contact_erased',
    'member_linked', 'member_unlinked', 'list_created', 'list_updated', 'list_archived',
    'membership_added', 'membership_removed', 'import_validated', 'import_attested', 'import_started',
    'import_completed', 'import_failed', 'import_cancelled', 'import_retried',
  ]), actor: z.string().min(1), importId: z.string().nullable(), payload: z.record(z.unknown()),
  occurredAt: z.string().datetime(), createdAt: z.string().datetime(),
});
export type MarketingDirectoryEvent = z.output<typeof marketingDirectoryEventSchema>;
