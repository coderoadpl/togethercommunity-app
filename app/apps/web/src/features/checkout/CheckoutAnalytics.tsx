import { useEffect, useRef } from 'react';

import type { CheckoutAnalyticsConfig, CheckoutPurchaseAnalytics } from '#core/domain/index.js';

import { loadGoogleTag, loadMetaPixel, trackCheckoutPurchase } from './analytics.js';
import { useFullNavigationExit } from './use-full-navigation-exit.js';

export const CheckoutAnalytics = ({ config, sessionId, purchase, testMode }: {
  config: CheckoutAnalyticsConfig;
  sessionId: string | null;
  purchase: CheckoutPurchaseAnalytics | undefined;
  testMode: boolean;
}) => {
  const loaded = useRef<boolean | null>(null);
  const metaAttempted = useRef(false);
  const armFullNavigationExit = useFullNavigationExit();
  useEffect(() => {
    if (!testMode && loaded.current === null) {
      loaded.current = loadGoogleTag(config);
    }
    if (!testMode && !metaAttempted.current && (!config.metaPixelId || !sessionId || purchase !== undefined)) {
      metaAttempted.current = true;
      const metaLoaded = purchase === undefined ? loadMetaPixel(config) : loadMetaPixel(config, purchase);
      loaded.current = loaded.current || metaLoaded;
    }
    if (loaded.current) armFullNavigationExit();
    if (!testMode && loaded.current && purchase !== undefined) trackCheckoutPurchase(config, sessionId, purchase);
  }, [config, sessionId, purchase, testMode, armFullNavigationExit]);
  return null;
};
