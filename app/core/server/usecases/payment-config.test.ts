import { describe, expect, it } from 'vitest';

import { err, internal, ok, type StripeMode, type TenantSecret, type TenantSecretKey } from '#core/domain/index.js';

import type { EffectivePaymentConfig } from '../ports.js';
import {
  checkoutPaymentsReady,
  createWorkspacePaymentConfigReader,
  paymentConfigReader,
  paymentsReady,
  workspaceSecretsFromRows,
} from './payment-config.js';

const row = (key: TenantSecretKey, value: string): TenantSecret => ({
  id: `secret-${key}`, tenantId: 'acme', key, ciphertext: value, iv: 'iv', authTag: 'tag', maskedPreview: '***', updatedAt: '2026-11-25T10:00:00.000Z',
});

const crypto = {
  decrypt: ({ ciphertext }: { ciphertext: string }) => ciphertext === 'unreadable' ? err(internal('Stored secret failed integrity verification')) : ok(ciphertext),
};

const answer = (overrides: Partial<EffectivePaymentConfig>): EffectivePaymentConfig =>
  ({ source: 'workspace', keyPresent: true, webhookReady: true, keyMode: 'live', ...overrides });

describe('workspace payment configuration rule', () => {
  const rows = [
    row('stripe.restrictedKey', 'rk_live_own'),
    row('stripe.webhookSecret', 'whsec_live'),
    row('stripe.testRestrictedKey', 'unreadable'),
  ];

  it.each(['live', 'test'] as const)('reads the %s key, its signing secret and its mode', async (mode) => {
    const reader = createWorkspacePaymentConfigReader(workspaceSecretsFromRows(rows), crypto);
    expect(await reader.read('acme', mode)).toEqual(mode === 'live'
      ? { source: 'workspace', keyPresent: true, webhookReady: true, keyMode: 'live' }
      : { source: 'workspace', keyPresent: true, webhookReady: false, keyMode: null });
  });

  it('reports no mode when no decrypter is supplied', async () => {
    expect(await createWorkspacePaymentConfigReader(workspaceSecretsFromRows(rows)).read('acme', 'live'))
      .toEqual({ source: 'workspace', keyPresent: true, webhookReady: true, keyMode: null });
  });

  it('prefers the effective reader and falls back to the workspace rule without one', async () => {
    const inherited = answer({ source: 'organization', webhookReady: false });
    const effective = { read: async () => inherited };
    expect(await paymentConfigReader(effective, workspaceSecretsFromRows(rows), crypto).read('acme', 'live')).toEqual(inherited);
    expect(await paymentConfigReader(undefined, workspaceSecretsFromRows(rows), crypto).read('acme', 'live')).toEqual(answer({}));
  });
});

describe('payment readiness', () => {
  it.each<{ config: EffectivePaymentConfig; mode: StripeMode; ready: boolean; checkout: boolean }>([
    { config: answer({}), mode: 'live', ready: true, checkout: true },
    { config: answer({ keyMode: null }), mode: 'live', ready: true, checkout: true },
    { config: answer({ keyMode: 'test' }), mode: 'live', ready: true, checkout: false },
    { config: answer({ webhookReady: false }), mode: 'live', ready: false, checkout: false },
    { config: answer({ keyPresent: false }), mode: 'test', ready: false, checkout: false },
    { config: answer({ source: 'organization', webhookReady: false }), mode: 'live', ready: false, checkout: false },
  ])('answers ready $ready and checkout $checkout for %j', ({ config, mode, ready, checkout }) => {
    expect(paymentsReady(config)).toBe(ready);
    expect(checkoutPaymentsReady(config, mode)).toBe(checkout);
  });
});
