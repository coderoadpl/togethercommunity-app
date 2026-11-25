import { describe, expect, it } from 'vitest';

import type { StripeMode } from '#core/domain/index.js';

import type { OrganizationPaymentConfig, PaymentSource } from '../ports.js';
import { memoizedPaymentSource, organizationCheckoutReady, organizationPaymentsReady } from './payment-source.js';

const organization = (overrides: Partial<OrganizationPaymentConfig>): OrganizationPaymentConfig =>
  ({ source: 'organization', keyPresent: true, webhookReady: true, keyMode: 'live', ...overrides });

describe('organization payment readiness', () => {
  it.each<{ config: OrganizationPaymentConfig; mode: StripeMode; ready: boolean; checkout: boolean }>([
    { config: organization({}), mode: 'live', ready: true, checkout: true },
    { config: organization({ keyMode: null }), mode: 'live', ready: true, checkout: true },
    { config: organization({ keyMode: 'test' }), mode: 'live', ready: true, checkout: false },
    { config: organization({ webhookReady: false }), mode: 'live', ready: false, checkout: false },
    { config: organization({ keyPresent: false }), mode: 'test', ready: false, checkout: false },
  ])('answers ready $ready and checkout $checkout for %j', ({ config, mode, ready, checkout }) => {
    expect(organizationPaymentsReady(config)).toBe(ready);
    expect(organizationCheckoutReady(config, mode)).toBe(checkout);
  });
});

describe('memoized payment source', () => {
  it('reads each workspace and mode once', async () => {
    const reads: string[] = [];
    const reader = memoizedPaymentSource({
      read: async (tenantId, mode): Promise<PaymentSource> => {
        reads.push(`${tenantId}:${mode}`);
        return tenantId === 'studio' && mode === 'live' ? organization({ webhookReady: false }) : { source: 'workspace' };
      },
    });
    const answers = [
      await reader.read('studio', 'live'),
      await reader.read('studio', 'live'),
      await reader.read('studio', 'test'),
      await reader.read('acme', 'live'),
    ];
    expect(answers).toEqual([
      organization({ webhookReady: false }),
      organization({ webhookReady: false }),
      { source: 'workspace' },
      { source: 'workspace' },
    ]);
    expect(reads).toEqual(['studio:live', 'studio:test', 'acme:live']);
  });
});
