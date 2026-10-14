import { describe, expect, it } from 'vitest';

import {
  analyticsConsentCookieNameSchema,
  analyticsConsentCookieValueSchema,
  analyticsConsentEventSchema,
  analyticsTagIdSchema,
  shouldLoadCheckoutAnalytics,
  type CheckoutAnalyticsConfig,
} from './checkout-analytics.js';
import { updateTenantSettingsInputSchema } from './tenant.js';

const config: CheckoutAnalyticsConfig = {
  tagId: 'GTM-ABCD', consentCookieName: 'consent', consentCookieValue: 'analytics:true', consentEvent: null, loadWithoutConsent: false,
};

describe('checkout analytics validation', () => {
  it.each(['GTM-AB12', `GTM-${'A'.repeat(12)}`, 'G-AB1234', `G-${'A'.repeat(14)}`])('accepts tag %s', (tag) => {
    expect(analyticsTagIdSchema.safeParse(tag).success).toBe(true);
  });
  it.each(['', 'GTM-ABC', `GTM-${'A'.repeat(13)}`, 'G-ABCDE', `G-${'A'.repeat(15)}`, 'GTM-abcd', 'GTM-ABCD<script>', ' GTM-ABCD'])('rejects tag %s', (tag) => {
    expect(analyticsTagIdSchema.safeParse(tag).success).toBe(false);
  });
  it.each(['consent', 'cmp.analytics-v2_1', 'a'.repeat(64)])('accepts cookie name %s', (name) => {
    expect(analyticsConsentCookieNameSchema.safeParse(name).success).toBe(true);
  });
  it.each(['', 'a'.repeat(65), 'cookie name', 'cookie=value', 'cookie;other'])('rejects cookie name %s', (name) => {
    expect(analyticsConsentCookieNameSchema.safeParse(name).success).toBe(false);
  });
  it.each(['site_consent', 'Consent123', 'a'.repeat(64)])('accepts consent event %s', (name) => {
    expect(analyticsConsentEventSchema.safeParse(name).success).toBe(true);
  });
  it.each(['', 'a'.repeat(65), 'site consent', 'site-consent', 'site.consent', '<script>'])('rejects consent event %s', (name) => {
    expect(analyticsConsentEventSchema.safeParse(name).success).toBe(false);
  });
  it('limits the consent substring to 128 characters and supports clearing text settings', () => {
    expect(analyticsConsentCookieValueSchema.safeParse('a'.repeat(128)).success).toBe(true);
    expect(analyticsConsentCookieValueSchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(updateTenantSettingsInputSchema.parse({
      analyticsTagId: '', analyticsConsentCookieName: '', analyticsConsentCookieValue: '', analyticsConsentEvent: '',
    })).toEqual({ analyticsTagId: null, analyticsConsentCookieName: null, analyticsConsentCookieValue: null, analyticsConsentEvent: null });
    expect(updateTenantSettingsInputSchema.parse({})).toEqual({});
  });
});

describe('checkout analytics consent rule', () => {
  it('never loads without a configured tag', () => {
    expect(shouldLoadCheckoutAnalytics(null, 'consent=analytics:true')).toBe(false);
    expect(shouldLoadCheckoutAnalytics(undefined, 'consent=analytics:true')).toBe(false);
  });
  it.each([true, false])('applies the consent truth table with loadWithoutConsent=%s', (loadWithoutConsent) => {
    for (const consentCookieName of [null, 'consent']) {
      for (const consentCookieValue of [null, 'analytics:true']) {
        for (const cookieHeader of ['', 'consent=analytics:false', 'consent=analytics:true']) {
          const expected = loadWithoutConsent || (consentCookieName !== null && cookieHeader !== '' &&
            (consentCookieValue === null || cookieHeader.includes(consentCookieValue)));
          expect(shouldLoadCheckoutAnalytics({ ...config, loadWithoutConsent, consentCookieName, consentCookieValue }, cookieHeader)).toBe(expected);
        }
      }
    }
  });
  it('checks the required fragment after decoding the consent JSON cookie', () => {
    const jsonConfig = { ...config, consentCookieValue: '"choice":"granted"' };
    expect(shouldLoadCheckoutAnalytics(jsonConfig, `consent=${encodeURIComponent('{"choice":"granted","date":"2026-10-14"}')}`)).toBe(true);
    expect(shouldLoadCheckoutAnalytics(jsonConfig, `consent=${encodeURIComponent('{"choice":"denied","date":"2026-10-14"}')}`)).toBe(false);
    expect(shouldLoadCheckoutAnalytics(jsonConfig, '')).toBe(false);
  });
  it('matches exact names, empty cookie presence, encoded values, and malformed encodings', () => {
    expect(shouldLoadCheckoutAnalytics(config, 'otherconsent=analytics:true')).toBe(false);
    expect(shouldLoadCheckoutAnalytics(config, 'other=value; consent=analytics%3Atrue; last=value')).toBe(true);
    expect(shouldLoadCheckoutAnalytics(config, 'consent=%bad analytics:true')).toBe(true);
    expect(shouldLoadCheckoutAnalytics({ ...config, consentCookieValue: null }, 'consent=')).toBe(true);
    expect(shouldLoadCheckoutAnalytics({ ...config, consentCookieValue: null }, 'consent')).toBe(false);
  });
});
