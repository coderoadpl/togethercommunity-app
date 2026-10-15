import { z } from 'zod';

import { normalizeEmail } from './email.js';
import { staffRoleSchema } from './identity.js';

export const tenantTeamMemberSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  name: z.string().nullable(),
  role: staffRoleSchema,
  status: z.enum(['invited', 'active']),
  invitedAt: z.string().datetime().optional(),
});

export type TenantTeamMember = z.infer<typeof tenantTeamMemberSchema>;

export const addTenantAdminInputSchema = z.object({
  email: z.string().transform(normalizeEmail).pipe(z.string().email()),
});

export type AddTenantAdminInput = z.infer<typeof addTenantAdminInputSchema>;

export const removeTenantAdminInputSchema = z.object({
  userId: z.string().min(1),
});

export type RemoveTenantAdminInput = z.infer<typeof removeTenantAdminInputSchema>;
