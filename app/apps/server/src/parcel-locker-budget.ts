import type { PublicRateLimitRepository } from '#core/server/index.js';
import { safeErrorMessage } from '#core/server/log-safety.js';

import { recordException } from './telemetry.js';

export const lookupBudgetSpentOnError = (buckets: PublicRateLimitRepository, logger: { error(message: string): void }): PublicRateLimitRepository => ({
  claim: async (input) => {
    try {
      return await buckets.claim(input);
    } catch (cause) {
      recordException(cause);
      logger.error(`[parcel-locker] the ${input.scope} lookup budget could not be claimed, so the locker is not verified: ${safeErrorMessage(cause)}`);
      return false;
    }
  },
  purgeExpired: (before) => buckets.purgeExpired(before),
});
