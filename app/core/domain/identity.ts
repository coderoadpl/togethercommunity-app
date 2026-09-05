import { z } from 'zod';

import type { Language } from './language.js';

export const staffRoleSchema = z.enum(['owner', 'admin']);

export type StaffRole = z.infer<typeof staffRoleSchema>;

export const signInMethodSchema = z.enum(['password', 'magic-link']);

export type SignInMethod = z.infer<typeof signInMethodSchema>;

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
  memberLanguage: Language | null;
  memberVideoAutoplay: boolean;
}
