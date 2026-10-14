import { z } from 'zod';

export const analyticsTagIdSchema = z.string().regex(/^(?:GTM-[A-Z0-9]{4,12}|G-[A-Z0-9]{6,14})$/);
export const analyticsConsentCookieNameSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);
export const analyticsConsentCookieValueSchema = z.string().max(128);
export const analyticsConsentEventSchema = z.string().regex(/^[A-Za-z0-9_]{1,64}$/);

export const checkoutAnalyticsConfigSchema = z.object({
  tagId: analyticsTagIdSchema,
  consentCookieName: analyticsConsentCookieNameSchema.nullable(),
  consentCookieValue: analyticsConsentCookieValueSchema.nullable(),
  consentEvent: analyticsConsentEventSchema.nullable(),
  loadWithoutConsent: z.boolean(),
});
export type CheckoutAnalyticsConfig = z.infer<typeof checkoutAnalyticsConfigSchema>;

export const checkoutPurchaseAnalyticsSchema = z.object({
  transactionId: z.string().min(1),
  offerSlug: z.string().nullable(),
  value: z.number().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  items: z.array(z.object({
    itemId: z.string().min(1),
    itemName: z.string().min(1),
    price: z.number().nonnegative(),
  })),
});
export type CheckoutPurchaseAnalytics = z.infer<typeof checkoutPurchaseAnalyticsSchema>;

export const shouldLoadCheckoutAnalytics = (
  config: CheckoutAnalyticsConfig | null | undefined,
  cookieHeader: string,
): boolean => {
  if (!config?.tagId) return false;
  if (config.loadWithoutConsent) return true;
  if (!config.consentCookieName) return false;
  return cookieHeader.split(';').some((cookie) => {
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== config.consentCookieName) return false;
    const rawValue = cookie.slice(separator + 1);
    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      value = rawValue;
    }
    return config.consentCookieValue === null || value.includes(config.consentCookieValue);
  });
};
