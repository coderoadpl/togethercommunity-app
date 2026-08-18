import { z } from 'zod';

export const staffRoleSchema = z.enum(['owner', 'admin']);

export type StaffRole = z.infer<typeof staffRoleSchema>;

export interface Identity {
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image: string | null;
  tenantId: string | null;
  tenantSlug: string | null;
  tenantName: string | null;
  staffRole: StaffRole | null;
  memberId: string | null;
  memberDisplayName: string | null;
  memberBannedAt: string | null;
  memberDmOptOutAt: string | null;
}
