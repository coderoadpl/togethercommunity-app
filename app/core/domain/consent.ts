import { z } from 'zod';

export const consentSourceSchema = z.enum(['register', 'checkout']);

export type ConsentSource = z.infer<typeof consentSourceSchema>;

/**
 * Append-only acceptance record of the tenant's terms/privacy documents.
 * The URLs are snapshotted at acceptance time so the record stays meaningful
 * after the tenant edits its settings (URL = document version in this slice).
 */
export const termsConsentSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  userId: z.string().nullable(),
  email: z.string().nullable(),
  source: consentSourceSchema,
  termsUrl: z.string().nullable(),
  privacyUrl: z.string().nullable(),
  acceptedAt: z.string(),
});

export type TermsConsent = z.infer<typeof termsConsentSchema>;

export interface LegalUrls {
  termsUrl: string | null;
  privacyUrl: string | null;
}

export const EMPTY_LEGAL_URLS: LegalUrls = { termsUrl: null, privacyUrl: null };

export const legalUrlsConfigured = (legal: LegalUrls | null | undefined): legal is LegalUrls =>
  legal !== null && legal !== undefined && (legal.termsUrl !== null || legal.privacyUrl !== null);
