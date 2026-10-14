import { useEffect, useRef } from 'react';

import type { CheckoutAnalyticsConfig, CheckoutPurchaseAnalytics } from '#core/domain/index.js';

import { loadGoogleTag, trackCheckoutPurchase } from './analytics.js';

export const CheckoutAnalytics = ({ config, sessionId, purchase, testMode }: {
  config: CheckoutAnalyticsConfig;
  sessionId: string | null;
  purchase: CheckoutPurchaseAnalytics | undefined;
  testMode: boolean;
}) => {
  const loaded = useRef<boolean | null>(null);
  useEffect(() => {
    if (testMode) return;
    if (loaded.current === null) loaded.current = loadGoogleTag(config);
    if (loaded.current && purchase !== undefined) trackCheckoutPurchase(config, sessionId, purchase);
  }, [config, sessionId, purchase, testMode]);
  return null;
};
