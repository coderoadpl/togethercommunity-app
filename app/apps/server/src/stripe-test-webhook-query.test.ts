import { describe, expect, it } from 'vitest';

import { stripeTestWebhookQuery } from './stripe-test-webhook-query.js';

describe('stripeTestWebhookQuery', () => {
  it('carries the deployment bypass secret when staging opts in', () => {
    expect(stripeTestWebhookQuery({
      APP_ENV: 'staging',
      STRIPE_TEST_WEBHOOK_PROTECTION_BYPASS: true,
      VERCEL_AUTOMATION_BYPASS_SECRET: 'secret value/1',
    })).toBe('x-vercel-protection-bypass=secret+value%2F1');
  });

  it.each([
    { APP_ENV: 'production', STRIPE_TEST_WEBHOOK_PROTECTION_BYPASS: true, VERCEL_AUTOMATION_BYPASS_SECRET: 'secret' },
    { APP_ENV: undefined, STRIPE_TEST_WEBHOOK_PROTECTION_BYPASS: true, VERCEL_AUTOMATION_BYPASS_SECRET: 'secret' },
    { APP_ENV: 'stagign', STRIPE_TEST_WEBHOOK_PROTECTION_BYPASS: true, VERCEL_AUTOMATION_BYPASS_SECRET: 'secret' },
    { APP_ENV: 'staging', STRIPE_TEST_WEBHOOK_PROTECTION_BYPASS: false, VERCEL_AUTOMATION_BYPASS_SECRET: 'secret' },
    { APP_ENV: 'staging', STRIPE_TEST_WEBHOOK_PROTECTION_BYPASS: true, VERCEL_AUTOMATION_BYPASS_SECRET: undefined },
  ])('adds nothing for %o', (env) => {
    expect(stripeTestWebhookQuery(env)).toBeNull();
  });
});
