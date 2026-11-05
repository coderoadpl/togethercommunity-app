import { z } from 'zod';
import { metaCapiDefaultCopy } from './meta-capi-copy.pl.js';

export const metaCapiSettingsShape = {
  analyticsMetaCapiEnabled: z.boolean().optional(),
  analyticsMetaCapiTestEventCode: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).nullable().optional(),
  analyticsMetaCapiConsentHeading: z.string().trim().min(1).max(200).nullable().optional(),
  analyticsMetaCapiConsentBody: z.string().trim().min(1).max(4000).nullable().optional(),
  analyticsMetaCapiConsentAcceptLabel: z.string().trim().min(1).max(80).nullable().optional(),
  analyticsMetaCapiConsentDeclineLabel: z.string().trim().min(1).max(80).nullable().optional(),
};
export const metaCapiCopy = (settings: z.infer<z.ZodObject<typeof metaCapiSettingsShape>> & { privacyUrl?: string | null }) => ({
  heading: settings.analyticsMetaCapiConsentHeading ?? metaCapiDefaultCopy.heading,
  body: settings.analyticsMetaCapiConsentBody ?? metaCapiDefaultCopy.body,
  acceptLabel: settings.analyticsMetaCapiConsentAcceptLabel ?? metaCapiDefaultCopy.acceptLabel,
  declineLabel: settings.analyticsMetaCapiConsentDeclineLabel ?? metaCapiDefaultCopy.declineLabel,
  privacyUrl: settings.privacyUrl ?? null,
});
