import {
  shouldLoadCheckoutAnalytics,
  type CheckoutAnalyticsConfig,
  type CheckoutPurchaseAnalytics,
} from '#core/domain/index.js';

import { persistedJsonPreference } from '../../theme-mode.js';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...parameters: unknown[]) => void;
  }
}

let loadedTagId: string | null = null;

const isIsolatedReturnPage = (): boolean => {
  const baseDomain = import.meta.env.VITE_APP_BASE_DOMAIN?.toLowerCase().replace(/\.$/u, '');
  if (!baseDomain) return false;
  const hostname = window.location.hostname.toLowerCase().replace(/\.$/u, '');
  if (hostname === baseDomain || hostname.endsWith(`.${baseDomain}`)) return false;
  return /^\/(?:checkout|offer)\/[^/]+$/u.test(window.location.pathname) &&
    new URLSearchParams(window.location.search).get('status') === 'success';
};

const isTestPurchase = (): boolean => {
  const query = new URLSearchParams(window.location.search);
  return query.get('test_purchase') === '1' || query.get('session_id')?.startsWith('cs_test_') === true;
};

export const loadGoogleTag = (config: CheckoutAnalyticsConfig): boolean => {
  if (!isIsolatedReturnPage() || isTestPurchase() || !shouldLoadCheckoutAnalytics(config, document.cookie)) return false;
  if (loadedTagId !== null) return loadedTagId === config.tagId;

  const dataLayer = window.dataLayer ?? [];
  window.dataLayer = dataLayer;
  const gtag: (...parameters: unknown[]) => void = function () {
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
    ad_storage: 'denied',
    analytics_storage: 'granted',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  if (config.consentEvent !== null) {
    dataLayer.push({ event: config.consentEvent, [config.consentEvent]: 'granted' });
  }

  const script = document.createElement('script');
  script.async = true;
  if (config.tagId.startsWith('GTM-')) {
    dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    script.src = `https://www.googletagmanager.com/gtm.js?id=${config.tagId}`;
  } else {
    gtag('js', new Date());
    gtag('config', config.tagId, { cookie_domain: 'none' });
    script.src = `https://www.googletagmanager.com/gtag/js?id=${config.tagId}`;
  }
  loadedTagId = config.tagId;
  document.head.appendChild(script);
  return true;
};

export const trackCheckoutPurchase = (
  config: CheckoutAnalyticsConfig,
  sessionId: string | null,
  purchase: CheckoutPurchaseAnalytics,
): void => {
  if (isTestPurchase() || !sessionId || sessionId.startsWith('cs_test_') || loadedTagId !== config.tagId) return;
  const sent = persistedJsonPreference(
    `together.analytics.purchase.${sessionId}`,
    (value) => typeof value === 'boolean' ? value : undefined,
    false,
  );
  if (sent.load()) return;
  sent.save(true);
  // Without durable storage, suppress the event rather than duplicate it on reload.
  if (!sent.load()) return;

  const payload = {
    transaction_id: purchase.transactionId,
    value: purchase.value,
    currency: purchase.currency,
    items: purchase.items.map((item) => ({
      item_id: item.itemId,
      item_name: item.itemName,
      price: item.price,
      quantity: 1,
    })),
  };
  if (config.tagId.startsWith('GTM-')) {
    window.dataLayer?.push({ ecommerce: null });
    window.dataLayer?.push({ event: 'purchase', ecommerce: payload, offer_slug: purchase.offerSlug });
  } else {
    window.gtag?.('event', 'purchase', { ...payload, offer_slug: purchase.offerSlug });
  }
};
