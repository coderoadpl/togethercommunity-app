import { z } from 'zod';
import { metaCapiDefaultCopy as pl } from './meta-capi-copy.pl.js';
import { metaCapiDefaultCopy as en } from './meta-capi-copy.en.js';
import { DEFAULT_LANGUAGE, type Language } from './language.js';

export const metaCapiSettingsShape = {
  analyticsMetaCapiEnabled: z.boolean().optional(),
  analyticsMetaCapiTestEventCode: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).nullable().optional(),
  analyticsMetaCapiConsentHeading: z.string().trim().min(1).max(200).nullable().optional(),
  analyticsMetaCapiConsentBody: z.string().trim().min(1).max(4000).nullable().optional(),
  analyticsMetaCapiConsentAcceptLabel: z.string().trim().min(1).max(80).nullable().optional(),
  analyticsMetaCapiConsentDeclineLabel: z.string().trim().min(1).max(80).nullable().optional(),
};
export const metaCapiCopy = (settings: z.infer<z.ZodObject<typeof metaCapiSettingsShape>> & { privacyUrl?: string | null }, locale: Language = DEFAULT_LANGUAGE) => {
  const metaCapiDefaultCopy = locale === 'pl' ? pl : en;
  return {
    heading: settings.analyticsMetaCapiConsentHeading ?? metaCapiDefaultCopy.heading,
    body: settings.analyticsMetaCapiConsentBody ?? metaCapiDefaultCopy.body,
    acceptLabel: settings.analyticsMetaCapiConsentAcceptLabel ?? metaCapiDefaultCopy.acceptLabel,
    declineLabel: settings.analyticsMetaCapiConsentDeclineLabel ?? metaCapiDefaultCopy.declineLabel,
    privacyUrl: settings.privacyUrl ?? null,
  };
};
