import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { stripeTestWebhookQuery } from './stripe-test-webhook-query.js';

const PINNED_KEY = 'rk_test_pinned';
const pinnedDigest = createHash('sha256').update(PINNED_KEY).digest('hex');

const staging = {
  APP_ENV: 'staging',
  VERCEL_ENV: 'preview',
  STRIPE_TEST_WEBHOOK_PROTECTION_BYPASS: true,
  STRIPE_TEST_WEBHOOK_BYPASS_KEY_SHA256: pinnedDigest,
  VERCEL_AUTOMATION_BYPASS_SECRET: 'secret value/1',
};

describe('stripeTestWebhookQuery', () => {
  it('carries the deployment bypass secret for the pinned key only', () => {
    const query = stripeTestWebhookQuery(staging);
    expect(query?.(PINNED_KEY)).toBe('x-vercel-protection-bypass=secret+value%2F1');
    expect(query?.('rk_test_someone_else')).toBeNull();
    expect(query?.('')).toBeNull();
  });

  it('accepts an upper-case digest', () => {
    expect(stripeTestWebhookQuery({ ...staging, STRIPE_TEST_WEBHOOK_BYPASS_KEY_SHA256: pinnedDigest.toUpperCase() })?.(PINNED_KEY))
      .toBe('x-vercel-protection-bypass=secret+value%2F1');
  });

  it.each([
    ['production APP_ENV', { APP_ENV: 'production' }],
    ['no APP_ENV', { APP_ENV: undefined }],
    ['a misspelt APP_ENV', { APP_ENV: 'stagign' }],
    ['a production hosting environment', { VERCEL_ENV: 'production' }],
    ['the switch off', { STRIPE_TEST_WEBHOOK_PROTECTION_BYPASS: false }],
    ['no bypass secret', { VERCEL_AUTOMATION_BYPASS_SECRET: undefined }],
    ['no pinned digest', { STRIPE_TEST_WEBHOOK_BYPASS_KEY_SHA256: undefined }],
    ['a malformed digest', { STRIPE_TEST_WEBHOOK_BYPASS_KEY_SHA256: 'not-a-digest' }],
  ])('adds nothing with %s', (_name, override) => {
    expect(stripeTestWebhookQuery({ ...staging, ...override })).toBeNull();
  });
});
