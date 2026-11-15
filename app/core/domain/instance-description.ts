import { z } from 'zod';

export const DATABASE_IDENTITY_PATTERN = /^[0-9a-f]{16}$/;

export const instanceDescriptionSchema = z.object({
  baseDomain: z.string().min(1).nullable(),
  singleTenant: z.boolean(),
  databaseIdentity: z.string().regex(DATABASE_IDENTITY_PATTERN).nullable(),
});

export type InstanceDescription = z.output<typeof instanceDescriptionSchema>;
