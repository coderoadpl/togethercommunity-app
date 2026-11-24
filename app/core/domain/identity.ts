import { z } from 'zod';

import type { Language } from './language.js';

export const staffRoleSchema = z.enum(['owner', 'admin']);

export type StaffRole = z.infer<typeof staffRoleSchema>;

export const staffGrantSourceSchema = z.enum(['direct', 'organization']);

export type StaffGrantSource = z.infer<typeof staffGrantSourceSchema>;

export const signInMethodSchema = z.enum(['password', 'magic-link', 'passkey']);

export type SignInMethod = z.infer<typeof signInMethodSchema>;

export const MAGIC_LINK_TOKEN_EXPIRES_IN_SECONDS = 60 * 60;

export interface Identity {
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image: string | null;
  tenantAccess: 'none' | 'member' | 'staff';
  tenantId: string | null;
  tenantSlug: string | null;
  tenantName: string | null;
  staffRole: StaffRole | null;
  staffGrantSource?: StaffGrantSource;
  memberId: string | null;
  memberDisplayName: string | null;
  memberBannedAt: string | null;
  memberDmOptOutAt: string | null;
  memberLanguage: Language | null;
  memberVideoAutoplay: boolean | null;
}
