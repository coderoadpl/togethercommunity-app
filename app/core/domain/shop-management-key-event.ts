import { z } from 'zod';

const shopManagementKeyEventKindSchema = z.enum(['created', 'revoked', 'purged', 'request']);

const shopManagementKeyEventMethodSchema = z.enum(['POST', 'PUT', 'PATCH', 'DELETE']);

const SHOP_MANAGEMENT_KEY_EVENT_RESOURCE_ID_MAX_LENGTH = 200;

const shopManagementKeyEventResourceIdSchema = z.string()
  .max(SHOP_MANAGEMENT_KEY_EVENT_RESOURCE_ID_MAX_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const shopManagementKeyEventResourceId = (candidate: unknown): string | null => {
  const parsed = shopManagementKeyEventResourceIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
};

export const shopManagementKeyEventSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  apiKeyId: z.string().min(1),
  kind: shopManagementKeyEventKindSchema,
  actorUserId: z.string().min(1),
  method: shopManagementKeyEventMethodSchema.nullable(),
  route: z.string().min(1).nullable(),
  resourceId: shopManagementKeyEventResourceIdSchema.nullable(),
  at: z.string().datetime(),
});

export type ShopManagementKeyEvent = z.infer<typeof shopManagementKeyEventSchema>;

export interface ShopManagementKeyEventPage {
  events: ShopManagementKeyEvent[];
  nextCursor: string | null;
}
