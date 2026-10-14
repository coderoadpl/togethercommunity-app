import {
  shouldLoadCheckoutAnalytics,
  type CheckoutAnalyticsConfig,
  type CheckoutPurchaseAnalytics,
} from '#core/domain/index.js';

import { persistedJsonPreference } from '../../theme-mode.js';

type AnalyticsCommand = (...parameters: unknown[]) => void;

type MetaPixel = {
  (...parameters: unknown[]): void;
  callMethod?: AnalyticsCommand;
  queue: unknown[];
  push: AnalyticsCommand;
  loaded: boolean;
  version: string;
};

declare global {
  interface Window {
    fbq?: MetaPixel;
    _fbq?: MetaPixel;
    dataLayer?: unknown[];
    gtag?: AnalyticsCommand;
  }
}

let loadedTagId: string | null = null;
let loadedPixelId: string | null = null;

const isReturnPage = (): boolean => /^\/(?:checkout|offer)\/[^/]+$/u.test(window.location.pathname) &&
  new URLSearchParams(window.location.search).get('status') === 'success';

const isTestPurchase = (): boolean => {
  const query = new URLSearchParams(window.location.search);
  return query.get('test_purchase') === '1' || query.get('session_id')?.startsWith('cs_test_') === true;
};

export const loadGoogleTag = (config: CheckoutAnalyticsConfig): boolean => {
  if (!config.tagId || !isReturnPage() || isTestPurchase() || !shouldLoadCheckoutAnalytics(config, document.cookie)) return false;
  if (loadedTagId !== null) return loadedTagId === config.tagId;

  const dataLayer = window.dataLayer ?? [];
  window.dataLayer = dataLayer;
  const gtag: AnalyticsCommand = function () {
    // Google distinguishes native Arguments commands from data-layer method arrays.
    dataLayer.push(arguments.valueOf());
  };
  window.gtag = gtag;
  gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    wait_for_update: 500,
  });
  gtag('consent', 'update', {
    ad_storage: 'granted',
    analytics_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
  });
  gtag('js', new Date());
  gtag('config', config.tagId, { send_page_view: true });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${config.tagId}`;
  loadedTagId = config.tagId;
  document.head.appendChild(script);
  return true;
};

export const loadMetaPixel = (config: CheckoutAnalyticsConfig): boolean => {
  if (!config.metaPixelId || !isReturnPage() || isTestPurchase() || !shouldLoadCheckoutAnalytics(config, document.cookie)) return false;
  if (loadedPixelId !== null) return loadedPixelId === config.metaPixelId;

  const stub = function (...parameters: unknown[]): void {
    if (fbq.callMethod) fbq.callMethod(...parameters);
    else fbq.queue.push(arguments.valueOf());
  };
  const fbq: MetaPixel = window.fbq ?? Object.assign(stub, {
    queue: [], push: stub, loaded: true, version: '2.0',
  });
  window.fbq = fbq;
  window._fbq ??= fbq;
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  loadedPixelId = config.metaPixelId;
  document.head.appendChild(script);
  if (!config.loadWithoutConsent) fbq('consent', 'revoke');
  fbq('consent', 'grant');
  fbq('init', config.metaPixelId);
  fbq('track', 'PageView');
  return true;
};

const claimPurchase = (key: string): boolean => {
  const sent = persistedJsonPreference(
    key,
    (value) => typeof value === 'boolean' ? value : undefined,
    false,
  );
  if (sent.load()) return false;
  sent.save(true);
  // Without durable storage, suppress the event rather than duplicate it on reload.
  return sent.load();
};

export const trackCheckoutPurchase = (
  config: CheckoutAnalyticsConfig,
  sessionId: string | null,
  purchase: CheckoutPurchaseAnalytics,
): void => {
  if (isTestPurchase() || !sessionId || sessionId.startsWith('cs_test_')) return;
  if (config.tagId && loadedTagId === config.tagId && claimPurchase(`together.analytics.purchase.${sessionId}`)) {
    window.gtag?.('event', 'purchase', {
      transaction_id: purchase.transactionId,
      value: purchase.value,
      currency: purchase.currency,
      items: purchase.items.map((item) => ({
        item_id: item.itemId,
        item_name: item.itemName,
        price: item.price,
        quantity: 1,
      })),
      offer_slug: purchase.offerSlug,
    });
  }
  if (config.metaPixelId && loadedPixelId === config.metaPixelId && claimPurchase(`together.analytics.meta-purchase.${sessionId}`)) {
    window.fbq?.('track', 'Purchase', {
      value: purchase.value,
      currency: purchase.currency,
      content_type: 'product',
      content_ids: purchase.items.map((item) => item.itemId),
      contents: purchase.items.map((item) => ({ id: item.itemId, quantity: 1, item_price: item.price })),
      num_items: purchase.items.length,
    }, { eventID: purchase.transactionId });
  }
};
