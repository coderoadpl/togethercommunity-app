import { useEffect, useRef } from 'react';
import { useRouter } from '@tanstack/react-router';

import type { CheckoutAnalyticsConfig, CheckoutPurchaseAnalytics } from '#core/domain/index.js';

import { loadGoogleTag, loadMetaPixel, trackCheckoutPurchase } from './analytics.js';

export const CheckoutAnalytics = ({ config, sessionId, purchase, testMode }: {
  config: CheckoutAnalyticsConfig;
  sessionId: string | null;
  purchase: CheckoutPurchaseAnalytics | undefined;
  testMode: boolean;
}) => {
  const router = useRouter();
  const loaded = useRef<boolean | null>(null);
  const metaAttempted = useRef(false);
  useEffect(() => {
    const unblock = router.history.block({
      blockerFn: ({ currentLocation, nextLocation, action }) => {
        if (!loaded.current || (currentLocation.pathname === nextLocation.pathname &&
          currentLocation.search === nextLocation.search)) return false;
        // Keep POP blocked until unload so the router cannot roll back and cancel the document navigation.
        return new Promise<boolean>(() => {
          if (action === 'BACK' || action === 'FORWARD' || action === 'GO') {
            // POP already changed the URL; assigning it with a fragment would keep this document alive.
            window.location.reload();
          } else {
            window.location.assign(nextLocation.href);
          }
        });
      },
      enableBeforeUnload: false,
    });
    return () => {
      // Removing settings cannot unload the tag, so its navigation guard must survive this component.
      if (!loaded.current) unblock();
    };
  }, [router]);
  useEffect(() => {
    if (!testMode && loaded.current === null) {
      loaded.current = loadGoogleTag(config);
    }
    if (!testMode && !metaAttempted.current && (!config.metaPixelId || !sessionId || purchase !== undefined)) {
      metaAttempted.current = true;
      const metaLoaded = purchase === undefined ? loadMetaPixel(config) : loadMetaPixel(config, purchase);
      loaded.current = loaded.current || metaLoaded;
    }
    if (!testMode && loaded.current && purchase !== undefined) trackCheckoutPurchase(config, sessionId, purchase);
  }, [config, sessionId, purchase, testMode]);
  return null;
};
