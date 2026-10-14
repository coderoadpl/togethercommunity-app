import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckoutAnalyticsConfig } from '#core/domain/index.js';

const config: CheckoutAnalyticsConfig = {
  metaPixelId: null,
  tagId: 'G-ABC1234567',
  consentCookieName: 'analytics_consent',
  consentCookieValue: 'analytics:true',
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
  delete window.fbq;
  delete window._fbq;
});
afterEach(() => {
  scripts().forEach((script) => script.remove());
  document.querySelectorAll('script[src*="connect.facebook.net"]').forEach((script) => script.remove());
  document.cookie = 'analytics_consent=; max-age=0; path=/';
  delete window.dataLayer;
  delete window.gtag;
  delete window.fbq;
  delete window._fbq;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Google tag loading', () => {
  it('loads GA4 once with native consent commands before the measurement configuration', async () => {
    const { loadGoogleTag } = await import('./analytics.js');
    expect(loadGoogleTag(config)).toBe(true);
    expect(loadGoogleTag(config)).toBe(true);
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]).toHaveAttribute('src', 'https://www.googletagmanager.com/gtag/js?id=G-ABC1234567');
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
      expect.objectContaining({ 0: 'js', 1: expect.any(Date) }),
      expect.objectContaining({ 0: 'config', 1: 'G-ABC1234567', 2: { send_page_view: true } }),
    ]);
    expect(loadGoogleTag({ ...config, tagId: 'G-DEF1234567' })).toBe(false);
    expect(scripts()).toHaveLength(1);
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

  it('supports presence-only consent', async () => {
    document.cookie = 'analytics_consent=; path=/';
    const { loadGoogleTag } = await import('./analytics.js');
    expect(loadGoogleTag({ ...config, consentCookieValue: null })).toBe(true);
  });

  it('keeps an existing data layer', async () => {
    const existing = { event: 'existing' };
    window.dataLayer = [existing];
    const { loadGoogleTag } = await import('./analytics.js');
    loadGoogleTag(config);
    expect(window.dataLayer?.[0]).toBe(existing);
  });
});

it('sends purchases once per session, including after a module reload', async () => {
  const analytics = await import('./analytics.js');
  analytics.loadGoogleTag(config);
  analytics.trackCheckoutPurchase(config, 'cs_live_one', purchase);
  analytics.trackCheckoutPurchase(config, 'cs_live_one', purchase);
  expect(window.dataLayer?.slice(4)).toEqual([
    expect.objectContaining({ 0: 'event', 1: 'purchase', 2: { ...payload, offer_slug: 'course-bundle' } }),
  ]);
  vi.resetModules();
  const reloaded = await import('./analytics.js');
  reloaded.loadGoogleTag(config);
  const before = window.dataLayer?.length;
  reloaded.trackCheckoutPurchase(config, 'cs_live_one', purchase);
  expect(window.dataLayer).toHaveLength(before ?? 0);
  reloaded.trackCheckoutPurchase(config, 'cs_live_two', purchase);
  expect(window.dataLayer?.slice(-1)).toEqual([
    expect.objectContaining({ 0: 'event', 1: 'purchase', 2: { ...payload, offer_slug: 'course-bundle' } }),
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
  expect(window.dataLayer).toHaveLength(4);
});

it.each(['test_purchase=1', 'session_id=cs_test_one'])('never loads or sends a purchase in test mode (%s), even with consent bypassed', async (query) => {
  window.history.replaceState(null, '', `/offer/bundle?status=success&${query}`);
  const analytics = await import('./analytics.js');
  expect(analytics.loadGoogleTag({ ...config, loadWithoutConsent: true })).toBe(false);
  analytics.trackCheckoutPurchase(config, 'cs_test_one', purchase);
  expect(window.dataLayer).toBeUndefined();
  expect(scripts()).toHaveLength(0);
});

it('persists the session marker before the purchase command', async () => {
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
  expect(push).toHaveBeenCalledOnce();
});

it('suppresses purchases when the browser cannot persist the deduplication marker', async () => {
  const analytics = await import('./analytics.js');
  analytics.loadGoogleTag(config);
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => { throw new Error('Storage unavailable'); },
  });
  expect(() => analytics.trackCheckoutPurchase(config, 'cs_live_blocked', purchase)).not.toThrow();
  expect(window.dataLayer).toHaveLength(4);
});

it('preserves a null offer slug for purchases without a sales link', async () => {
  const analytics = await import('./analytics.js');
  analytics.loadGoogleTag(config);
  analytics.trackCheckoutPurchase(config, 'cs_live_no_offer', { ...purchase, offerSlug: null });
  expect(window.dataLayer?.slice(-1)).toEqual([
    expect.objectContaining({ 0: 'event', 1: 'purchase', 2: { ...payload, offer_slug: null } }),
  ]);
});

it('queues consent and bootstrap commands before inserting the script', async () => {
  const append = vi.spyOn(document.head, 'appendChild');
  append.mockImplementationOnce((node) => {
    expect(window.dataLayer).toEqual([
      expect.objectContaining({ 0: 'consent', 1: 'default' }),
      expect.objectContaining({ 0: 'consent', 1: 'update' }),
      expect.objectContaining({ 0: 'js', 1: expect.any(Date) }),
      expect.objectContaining({ 0: 'config', 1: config.tagId, 2: { send_page_view: true } }),
    ]);
    return node;
  });
  const analytics = await import('./analytics.js');
  expect(analytics.loadGoogleTag(config)).toBe(true);
  expect(append).toHaveBeenCalledOnce();
});

it('decodes JSON cookie values before checking consent', async () => {
  document.cookie = `analytics_consent=${encodeURIComponent('{"choice":"granted","date":"2026-10-14"}')}; path=/`;
  const analytics = await import('./analytics.js');
  expect(analytics.loadGoogleTag({ ...config, consentCookieValue: '"choice":"granted"' })).toBe(true);
  expect(scripts()).toHaveLength(1);
});

it.each(['togethercommunity.app', 'acme.togethercommunity.app', 'checkout.example.test'])('loads on the success return independently of host (%s)', async (hostname) => {
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, hostname });
  const { loadGoogleTag } = await import('./analytics.js');
  expect(loadGoogleTag(config)).toBe(true);
  expect(scripts()).toHaveLength(1);
});

it.each([
  '/checkout/course', '/checkout/course?status=cancelled', '/offer/bundle',
  '/offer/bundle?status=cancelled', '/my/courses?status=success', '/?status=success',
])('does not load outside a successful checkout return (%s)', async (path) => {
  window.history.replaceState(null, '', path);
  const { loadGoogleTag } = await import('./analytics.js');
  expect(loadGoogleTag({ ...config, loadWithoutConsent: true })).toBe(false);
  expect(scripts()).toHaveLength(0);
  expect(window.dataLayer).toBeUndefined();
});

describe('GA4 consent commands', () => {
  it.each([
    { mode: 'matching cookie', cookie: 'analytics%3Atrue', consentCookieValue: 'analytics:true', loadWithoutConsent: false },
    { mode: 'cookie presence', cookie: '', consentCookieValue: null, loadWithoutConsent: false },
  ])('grants all four consent types with $mode', async ({ cookie, consentCookieValue, loadWithoutConsent }) => {
    document.cookie = `analytics_consent=${cookie}; path=/`;
    const { loadGoogleTag } = await import('./analytics.js');
    expect(loadGoogleTag({ ...config, consentCookieValue, loadWithoutConsent })).toBe(true);
    expect(window.dataLayer?.slice(0, 2)).toEqual([
      expect.objectContaining({ 0: 'consent', 1: 'default', 2: {
        analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied',
        ad_personalization: 'denied', wait_for_update: 500,
      } }),
      expect.objectContaining({ 0: 'consent', 1: 'update', 2: {
        analytics_storage: 'granted', ad_storage: 'granted',
        ad_user_data: 'granted', ad_personalization: 'granted',
      } }),
    ]);
  });

  it.each([null, 'analytics:false', 'analytics%3Atrue'])('grants only analytics with the bypass enabled (cookie: %s)', async (cookie) => {
    document.cookie = cookie === null
      ? 'analytics_consent=; max-age=0; path=/'
      : `analytics_consent=${cookie}; path=/`;
    const { loadGoogleTag } = await import('./analytics.js');
    expect(loadGoogleTag({ ...config, loadWithoutConsent: true })).toBe(true);
    expect(window.dataLayer?.slice(0, 2)).toEqual([
      expect.objectContaining({ 0: 'consent', 1: 'default', 2: {
        analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied',
        ad_personalization: 'denied', wait_for_update: 500,
      } }),
      expect.objectContaining({ 0: 'consent', 1: 'update', 2: { analytics_storage: 'granted' } }),
    ]);
    expect(scripts()).toHaveLength(1);
  });
});


describe('Meta Pixel', () => {
  const meta = { ...config, tagId: null, metaPixelId: '123456789012345' };
  const metaScripts = () => document.querySelectorAll('script[src*="connect.facebook.net"]');
  const metaPayload = {
    value: 99.5, currency: 'PLN', content_type: 'product',
    content_ids: ['product-1', 'product-2'],
    contents: [
      { id: 'product-1', quantity: 1, item_price: 75 },
      { id: 'product-2', quantity: 1, item_price: 24.5 },
    ],
    num_items: 2,
  };

  it('loads independently once with consent, init and PageView commands', async () => {
    const analytics = await import('./analytics.js');
    expect(analytics.loadGoogleTag(meta)).toBe(false);
    expect(analytics.loadMetaPixel(meta)).toBe(true);
    expect(analytics.loadMetaPixel(meta)).toBe(true);
    expect(metaScripts()).toHaveLength(1);
    expect(metaScripts()[0]).toHaveAttribute('src', 'https://connect.facebook.net/en_US/fbevents.js');
    expect(metaScripts()[0]?.textContent).toBe('');
    expect(window.fbq).toBe(window._fbq);
    expect(window.fbq?.loaded).toBe(true);
    expect(window.fbq?.version).toBe('2.0');
    expect(window.fbq?.push).toBe(window.fbq);
    expect(window.fbq?.queue).toEqual([
      expect.objectContaining({ 0: 'consent', 1: 'grant' }),
      expect.objectContaining({ 0: 'init', 1: meta.metaPixelId }),
      expect.objectContaining({ 0: 'track', 1: 'PageView' }),
    ]);
    expect(analytics.loadMetaPixel({ ...meta, metaPixelId: '987654321098765' })).toBe(false);
    expect(metaScripts()).toHaveLength(1);
  });

  it.each(['', 'analytics:false'])('revokes consent without loading or initializing when the cookie rule fails (%s)', async (cookie) => {
    document.cookie = cookie === ''
      ? 'analytics_consent=; max-age=0; path=/'
      : `analytics_consent=${cookie}; path=/`;
    const analytics = await import('./analytics.js');
    expect(analytics.loadMetaPixel(meta)).toBe(false);
    expect(metaScripts()).toHaveLength(0);
    expect(window.fbq?.queue).toEqual([
      expect.objectContaining({ 0: 'consent', 1: 'revoke' }),
    ]);
    analytics.trackCheckoutPurchase(meta, 'cs_live_denied', purchase);
    expect(window.fbq?.queue).toHaveLength(1);
  });

  it('loads and grants consent when a previously declined cookie starts matching', async () => {
    document.cookie = 'analytics_consent=analytics:false; path=/';
    const analytics = await import('./analytics.js');
    expect(analytics.loadMetaPixel(meta)).toBe(false);
    document.cookie = 'analytics_consent=analytics%3Atrue; path=/';
    expect(analytics.loadMetaPixel(meta)).toBe(true);
    expect(analytics.loadMetaPixel(meta)).toBe(true);
    expect(metaScripts()).toHaveLength(1);
    expect(window.fbq?.queue).toEqual([
      expect.objectContaining({ 0: 'consent', 1: 'revoke' }),
      expect.objectContaining({ 0: 'consent', 1: 'grant' }),
      expect.objectContaining({ 0: 'init', 1: meta.metaPixelId }),
      expect.objectContaining({ 0: 'track', 1: 'PageView' }),
    ]);
  });

  it('does not load a pixel when only GA4 is configured', async () => {
    const analytics = await import('./analytics.js');
    expect(analytics.loadMetaPixel(config)).toBe(false);
    expect(metaScripts()).toHaveLength(0);
    expect(window.fbq).toBeUndefined();
  });

  it.each([
    { cookie: '', fragment: null },
    { cookie: '%7B%22choice%22%3A%22granted%22%7D', fragment: '"choice":"granted"' },
  ])('accepts presence-only or decoded JSON consent ($cookie)', async ({ cookie, fragment }) => {
    document.cookie = `analytics_consent=${cookie}; path=/`;
    const analytics = await import('./analytics.js');
    expect(analytics.loadMetaPixel({ ...meta, consentCookieValue: fragment })).toBe(true);
    expect(metaScripts()).toHaveLength(1);
  });

  it('grants bypassed consent without first revoking it', async () => {
    document.cookie = 'analytics_consent=; max-age=0; path=/';
    const analytics = await import('./analytics.js');
    expect(analytics.loadMetaPixel({ ...meta, loadWithoutConsent: true })).toBe(true);
    expect(window.fbq?.queue).toEqual([
      expect.objectContaining({ 0: 'consent', 1: 'grant' }),
      expect.objectContaining({ 0: 'init', 1: meta.metaPixelId }),
      expect.objectContaining({ 0: 'track', 1: 'PageView' }),
    ]);
  });

  it('sends the exact Purchase once, independently of the GA4 marker and after reload', async () => {
    const analytics = await import('./analytics.js');
    const both = { ...config, metaPixelId: meta.metaPixelId };
    analytics.loadGoogleTag(both);
    analytics.loadMetaPixel(both);
    analytics.trackCheckoutPurchase(both, 'cs_live_both', purchase);
    analytics.trackCheckoutPurchase(both, 'cs_live_both', purchase);
    expect(window.dataLayer).toHaveLength(5);
    expect(window.fbq?.queue).toHaveLength(4);
    expect(window.fbq?.queue[3]).toEqual(expect.objectContaining({
      0: 'track', 1: 'Purchase', 2: metaPayload, 3: { eventID: 'order-1' },
    }));
    vi.resetModules();
    const reloaded = await import('./analytics.js');
    reloaded.loadMetaPixel(meta);
    const before = window.fbq?.queue.length;
    reloaded.trackCheckoutPurchase(meta, 'cs_live_both', purchase);
    expect(window.fbq?.queue).toHaveLength(before ?? 0);
  });

  it('persists the marker before dispatching through the initialized library', async () => {
    const analytics = await import('./analytics.js');
    analytics.loadMetaPixel(meta);
    const { persistedJsonPreference } = await import('../../theme-mode.js');
    const marker = persistedJsonPreference(
      'together.analytics.meta-purchase.cs_live_meta_ordering',
      (value) => typeof value === 'boolean' ? value : undefined,
      false,
    );
    const callMethod = vi.fn(() => { expect(marker.load()).toBe(true); });
    if (window.fbq) window.fbq.callMethod = callMethod;
    analytics.trackCheckoutPurchase(meta, 'cs_live_meta_ordering', purchase);
    expect(callMethod).toHaveBeenCalledExactlyOnceWith('track', 'Purchase', metaPayload, { eventID: 'order-1' });
  });

  it('sends nothing without a loaded pixel, session ID or durable marker', async () => {
    const analytics = await import('./analytics.js');
    analytics.trackCheckoutPurchase(meta, 'cs_live_meta_absent', purchase);
    expect(window.fbq).toBeUndefined();
    analytics.loadMetaPixel(meta);
    analytics.trackCheckoutPurchase(meta, null, purchase);
    analytics.trackCheckoutPurchase(meta, '', purchase);
    analytics.trackCheckoutPurchase(meta, 'cs_test_one', purchase);
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('Storage unavailable'); },
    });
    analytics.trackCheckoutPurchase(meta, 'cs_live_meta_blocked', purchase);
    expect(window.fbq?.queue).toHaveLength(3);
  });

  it.each(['test_purchase=1', 'session_id=cs_test_one'])('does nothing in test mode (%s)', async (query) => {
    window.history.replaceState(null, '', `/offer/bundle?status=success&${query}`);
    const analytics = await import('./analytics.js');
    expect(analytics.loadMetaPixel({ ...meta, loadWithoutConsent: true })).toBe(false);
    analytics.trackCheckoutPurchase(meta, 'cs_test_one', purchase);
    expect(window.fbq).toBeUndefined();
    expect(metaScripts()).toHaveLength(0);
  });

  it.each(['/offer/bundle', '/checkout/course?status=cancelled', '/my?status=success'])('does not load outside the success return (%s)', async (path) => {
    window.history.replaceState(null, '', path);
    const analytics = await import('./analytics.js');
    expect(analytics.loadMetaPixel({ ...meta, loadWithoutConsent: true })).toBe(false);
    expect(metaScripts()).toHaveLength(0);
  });
});
