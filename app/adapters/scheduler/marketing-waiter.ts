import type { MarketingWaiter } from '#core/server/index.js';

export const createMarketingWaiter = (): MarketingWaiter => ({
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
});
