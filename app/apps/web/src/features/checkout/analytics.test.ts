import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckoutAnalyticsConfig } from '#core/domain/index.js';

const config: CheckoutAnalyticsConfig = {
  tagId: 'GTM-ABC1234',
  consentCookieName: 'analytics_consent',
  consentCookieValue: 'analytics:true',
  consentEvent: null,
  loadWithoutConsent: false,
};
const purchase = {
  offerSlug: 'course-bundle',
  transactionId: 'order-1',
  value: 99.5,
  currency: 'PLN',
  items: [
    { itemId: 'product-1', itemName: 'Course', price: 75 },
    { itemId: 'product-2', itemName: 'Workbook', price: 24.5 },
  ],
};
const payload = {
  transaction_id: 'order-1', value: 99.5, currency: 'PLN',
  items: [
    { item_id: 'product-1', item_name: 'Course', price: 75, quantity: 1 },
    { item_id: 'product-2', item_name: 'Workbook', price: 24.5, quantity: 1 },
  ],
};
const scripts = () => document.querySelectorAll('script[src*="googletagmanager.com"]');

beforeEach(() => {
  vi.resetModules();
  window.history.replaceState(null, '', '/checkout/course?status=success');
  document.cookie = 'analytics_consent=analytics%3Atrue; path=/';
  delete window.dataLayer;
  delete window.gtag;
});
afterEach(() => {
  scripts().forEach((script) => script.remove());
  document.cookie = 'analytics_consent=; max-age=0; path=/';
  delete window.dataLayer;
  delete window.gtag;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Google tag loading', () => {
  it.each([null, 'site_consent'])('loads GTM once with the consent sequence before the bootstrap event (%s)', async (consentEvent) => {
    const { loadGoogleTag } = await import('./analytics.js');
    expect(loadGoogleTag({ ...config, consentEvent })).toBe(true);
    expect(loadGoogleTag({ ...config, consentEvent })).toBe(true);
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]).toHaveAttribute('src', 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234');
    expect(scripts()[0]?.textContent).toBe('');
    expect(Object.prototype.toString.call(window.dataLayer?.[0])).toBe('[object Arguments]');
    expect(Array.isArray(window.dataLayer?.[0])).toBe(false);
    expect(window.dataLayer).toEqual([
      expect.objectContaining({ 0: 'consent', 1: 'default', 2: {
        analytics_storage: 'denied', ad_storage: 'denied',
        ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500,
      } }),
      expect.objectContaining({ 0: 'consent', 1: 'update', 2: {
        analytics_storage: 'granted', ad_storage: 'granted',
        ad_user_data: 'granted', ad_personalization: 'granted',
      } }),
      ...(consentEvent === null ? [] : [{ event: consentEvent, [consentEvent]: 'granted' }]),
      { 'gtm.start': expect.any(Number), event: 'gtm.js' },
    ]);
    expect(loadGoogleTag({ ...config, tagId: 'G-ABC1234567' })).toBe(false);
    expect(scripts()).toHaveLength(1);
  });

  it('loads GA4 and configures the measurement ID after the consent update and event', async () => {
    const { loadGoogleTag } = await import('./analytics.js');
    expect(loadGoogleTag({ ...config, tagId: 'G-ABC1234567', consentEvent: 'site_consent' })).toBe(true);
    expect(scripts()[0]).toHaveAttribute('src', 'https://www.googletagmanager.com/gtag/js?id=G-ABC1234567');
    expect(window.dataLayer).toEqual([
      expect.objectContaining({ 0: 'consent', 1: 'default', 2: {
        analytics_storage: 'denied', ad_storage: 'denied',
        ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500,
      } }),
      expect.objectContaining({ 0: 'consent', 1: 'update', 2: {
        analytics_storage: 'granted', ad_storage: 'granted',
        ad_user_data: 'granted', ad_personalization: 'granted',
      } }),
      { event: 'site_consent', site_consent: 'granted' },
      expect.objectContaining({ 0: 'js', 1: expect.any(Date) }),
      expect.objectContaining({ 0: 'config', 1: 'G-ABC1234567' }),
    ]);
  });

  it.each(['', 'analytics:false'])('does not load without matching cookie consent (%s)', async (cookie) => {
    document.cookie = cookie === ''
      ? 'analytics_consent=; max-age=0; path=/'
      : `analytics_consent=${cookie}; path=/`;
    const { loadGoogleTag } = await import('./analytics.js');
    expect(loadGoogleTag(config)).toBe(false);
    expect(scripts()).toHaveLength(0);
    expect(window.dataLayer).toBeUndefined();
  });

  it('supports presence-only consent and the explicit consent bypass', async () => {
    document.cookie = 'analytics_consent=; path=/';
    const { loadGoogleTag } = await import('./analytics.js');
    expect(loadGoogleTag({ ...config, consentCookieValue: null })).toBe(true);
    document.cookie = 'analytics_consent=; max-age=0; path=/';
    expect(loadGoogleTag({ ...config, loadWithoutConsent: true })).toBe(true);
  });

  it('keeps an existing data layer', async () => {
    const existing = { event: 'existing' };
    window.dataLayer = [existing];
    const { loadGoogleTag } = await import('./analytics.js');
    loadGoogleTag(config);
    expect(window.dataLayer?.[0]).toBe(existing);
  });
});

it('pushes the exact GTM purchase once per session, including after a module reload', async () => {
  const analytics = await import('./analytics.js');
  analytics.loadGoogleTag(config);
  analytics.trackCheckoutPurchase(config, 'cs_live_one', purchase);
  analytics.trackCheckoutPurchase(config, 'cs_live_one', purchase);
  expect(window.dataLayer?.slice(3)).toEqual([
    { ecommerce: null }, { event: 'purchase', ecommerce: payload, offer_slug: 'course-bundle' },
  ]);
  vi.resetModules();
  const reloaded = await import('./analytics.js');
  reloaded.loadGoogleTag(config);
  const before = window.dataLayer?.length;
  reloaded.trackCheckoutPurchase(config, 'cs_live_one', purchase);
  expect(window.dataLayer).toHaveLength(before ?? 0);
  reloaded.trackCheckoutPurchase(config, 'cs_live_two', purchase);
  expect(window.dataLayer?.slice(-2)).toEqual([
    { ecommerce: null }, { event: 'purchase', ecommerce: payload, offer_slug: 'course-bundle' },
  ]);
});

it('pushes the exact GA4 purchase once per session', async () => {
  const analytics = await import('./analytics.js');
  const ga4 = { ...config, tagId: 'G-ABC1234567' };
  analytics.loadGoogleTag(ga4);
  analytics.trackCheckoutPurchase(ga4, 'cs_live_ga4', purchase);
  analytics.trackCheckoutPurchase(ga4, 'cs_live_ga4', purchase);
  expect(window.dataLayer).toHaveLength(5);
  expect(window.dataLayer?.[4]).toEqual(expect.objectContaining({ 0: 'event', 1: 'purchase', 2: { ...payload, offer_slug: 'course-bundle' } }));
});

it('sends nothing without a loaded tag or session ID', async () => {
  const analytics = await import('./analytics.js');
  analytics.trackCheckoutPurchase(config, 'cs_live_one', purchase);
  expect(window.dataLayer).toBeUndefined();
  analytics.loadGoogleTag(config);
  analytics.trackCheckoutPurchase(config, null, purchase);
  analytics.trackCheckoutPurchase(config, '', purchase);
  expect(window.dataLayer).toHaveLength(3);
});

it.each(['test_purchase=1', 'session_id=cs_test_one'])('never loads or sends a purchase in test mode (%s), even with consent bypassed', async (query) => {
  window.history.replaceState(null, '', `/offer/bundle?status=success&${query}`);
  const analytics = await import('./analytics.js');
  expect(analytics.loadGoogleTag({ ...config, loadWithoutConsent: true })).toBe(false);
  analytics.trackCheckoutPurchase(config, 'cs_test_one', purchase);
  expect(window.dataLayer).toBeUndefined();
  expect(scripts()).toHaveLength(0);
});

it('persists the session marker before either ecommerce push', async () => {
  const analytics = await import('./analytics.js');
  const { persistedJsonPreference } = await import('../../theme-mode.js');
  const queue: unknown[] = [];
  window.dataLayer = queue;
  analytics.loadGoogleTag(config);
  const marker = persistedJsonPreference(
    'together.analytics.purchase.cs_live_ordering',
    (value) => typeof value === 'boolean' ? value : undefined,
    false,
  );
  const push = vi.spyOn(queue, 'push').mockImplementation((...entries: unknown[]) => {
    expect(marker.load()).toBe(true);
    return Array.prototype.push.apply(queue, entries);
  });
  analytics.trackCheckoutPurchase(config, 'cs_live_ordering', purchase);
  expect(push).toHaveBeenCalledTimes(2);
});

it('suppresses purchases when the browser cannot persist the deduplication marker', async () => {
  const analytics = await import('./analytics.js');
  analytics.loadGoogleTag(config);
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => { throw new Error('Storage unavailable'); },
  });
  expect(() => analytics.trackCheckoutPurchase(config, 'cs_live_blocked', purchase)).not.toThrow();
  expect(window.dataLayer).toHaveLength(3);
});

it('preserves a null offer slug for purchases without a sales link', async () => {
  const analytics = await import('./analytics.js');
  analytics.loadGoogleTag(config);
  analytics.trackCheckoutPurchase(config, 'cs_live_no_offer', { ...purchase, offerSlug: null });
  expect(window.dataLayer?.slice(-2)).toEqual([
    { ecommerce: null }, { event: 'purchase', ecommerce: payload, offer_slug: null },
  ]);
});

it('queues consent and bootstrap commands before inserting the script', async () => {
  const append = vi.spyOn(document.head, 'appendChild');
  append.mockImplementationOnce((node) => {
    expect(window.dataLayer).toEqual([
      expect.objectContaining({ 0: 'consent', 1: 'default' }),
      expect.objectContaining({ 0: 'consent', 1: 'update' }),
      { event: 'site_consent', site_consent: 'granted' },
      { 'gtm.start': expect.any(Number), event: 'gtm.js' },
    ]);
    return node;
  });
  const analytics = await import('./analytics.js');
  expect(analytics.loadGoogleTag({ ...config, consentEvent: 'site_consent' })).toBe(true);
  expect(append).toHaveBeenCalledOnce();
});

it('decodes JSON cookie values before checking consent', async () => {
  document.cookie = `analytics_consent=${encodeURIComponent('{"choice":"granted","date":"2026-10-14"}')}; path=/`;
  const analytics = await import('./analytics.js');
  expect(analytics.loadGoogleTag({ ...config, consentCookieValue: '"choice":"granted"' })).toBe(true);
  expect(scripts()).toHaveLength(1);
});
