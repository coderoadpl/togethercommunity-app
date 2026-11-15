import { z } from 'zod';

const shopManagementKeyEventKindSchema = z.enum(['created', 'revoked', 'purged', 'request']);

const shopManagementKeyEventMethodSchema = z.enum(['POST', 'PUT', 'PATCH', 'DELETE']);

const shopManagementKeyEventOutcomeSchema = z.enum(['succeeded', 'refused', 'failed']);

export const shopManagementKeyEventSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  apiKeyId: z.string().min(1),
  kind: shopManagementKeyEventKindSchema,
  actorUserId: z.string().min(1).nullable(),
  method: shopManagementKeyEventMethodSchema.nullable(),
  route: z.string().min(1).nullable(),
  resourceId: z.string().min(1).nullable(),
  status: z.number().int().min(100).max(599).nullable(),
  outcome: shopManagementKeyEventOutcomeSchema,
  at: z.string().datetime(),
});

export type ShopManagementKeyEvent = z.infer<typeof shopManagementKeyEventSchema>;

export interface ShopManagementKeyEventPage {
  events: ShopManagementKeyEvent[];
  nextCursor: string | null;
}
