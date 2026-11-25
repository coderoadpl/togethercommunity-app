import type { StripeMode } from '#core/domain/index.js';

import type { OrganizationPaymentConfig, PaymentSource, PaymentSourceReader } from '../ports.js';

export const organizationPaymentsReady = (config: OrganizationPaymentConfig): boolean =>
  config.keyPresent && config.webhookReady;

export const organizationCheckoutReady = (config: OrganizationPaymentConfig, mode: StripeMode): boolean =>
  organizationPaymentsReady(config) && (config.keyMode === null || config.keyMode === mode);

export const memoizedPaymentSource = (reader: PaymentSourceReader): PaymentSourceReader => {
  const answers = new Map<string, Promise<PaymentSource>>();
  return {
    read: (tenantId, mode) => {
      const key = JSON.stringify([tenantId, mode]);
      const known = answers.get(key);
      if (known !== undefined) return known;
      const answer = reader.read(tenantId, mode);
      answers.set(key, answer);
      return answer;
    },
  };
};
