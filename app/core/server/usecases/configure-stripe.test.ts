import { describe, expect, it } from 'vitest';

import {
  err,
  integrationUnavailable,
  ok,
  type Identity,
  type TenantSecret,
} from '#core/domain/index.js';

import type { PaymentProvider, TenantSecretRepository } from '../ports.js';
import { configureStripe, type ConfigureStripeDeps } from './configure-stripe.js';

const identity = (staffRole: Identity['staffRole']): Identity => ({
  userId: 'owner-1',
  email: 'owner@example.test',
  name: 'Owner',
  emailVerified: true,
  tenantId: 'tenant-1',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole,
  memberId: null,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
});

const payment = (
  configureWebhook: NonNullable<PaymentProvider['configureWebhook']>,
  deleteWebhookEndpoint: NonNullable<PaymentProvider['deleteWebhookEndpoint']> = async () =>
    ok({ deleted: true }),
): PaymentProvider => ({
  configureWebhook,
  deleteWebhookEndpoint,
  createCheckoutSession: async () => { throw new Error('unused'); },
  expireCheckoutSession: async () => { throw new Error('unused'); },
  cancelSubscription: async () => { throw new Error('unused'); },
  verifyWebhookEvent: async () => { throw new Error('unused'); },
  test: async () => { throw new Error('unused'); },
});

const harness = (provider: PaymentProvider): { deps: ConfigureStripeDeps; rows: TenantSecret[] } => {
  const rows: TenantSecret[] = [];
  const tenantSecrets: TenantSecretRepository = {
    listByTenant: async (tenantId) => rows.filter((row) => row.tenantId === tenantId),
    findByKey: async (tenantId, key) =>
      rows.find((row) => row.tenantId === tenantId && row.key === key) ?? null,
    upsert: async (_tenantId, secret) => {
      const index = rows.findIndex((row) => row.tenantId === secret.tenantId && row.key === secret.key);
      if (index === -1) rows.push(secret);
      else rows[index] = secret;
      return secret;
    },
    delete: async () => false,
  };
  let id = 0;
  return {
    rows,
    deps: {
      appBaseUrl: 'https://app.example.test/base',
      payment: provider,
      tenantSecrets,
      secretCrypto: {
        encrypt: (plaintext) => ({ ciphertext: `encrypted:${plaintext}`, iv: 'iv', authTag: 'tag' }),
        decrypt: () => { throw new Error('unused'); },
      },
      ids: { nextId: () => `secret-${id += 1}` },
      clock: { nowIso: () => '2026-08-03T12:00:00.000Z' },
    },
  };
};

describe('configureStripe', () => {
  it('registers the tenant webhook before persisting the signing secret and key', async () => {
    const calls: Parameters<NonNullable<PaymentProvider['configureWebhook']>>[0][] = [];
    const h = harness(payment(async (input) => {
      calls.push(input);
      return ok({ webhookEndpointId: 'we_created', webhookSecret: 'whsec_created' });
    }));

    const result = await configureStripe(
      { identity: identity('owner') },
      { restrictedKey: 'rk_live_private' },
      h.deps,
    );

    expect(result).toEqual({
      ok: true,
      value: {
        mode: 'live',
        webhookUrl: 'https://app.example.test/base/api/webhooks/stripe/tenant-1',
      },
    });
    expect(calls).toEqual([{
      tenantId: 'tenant-1',
      restrictedKey: 'rk_live_private',
      webhookUrl: 'https://app.example.test/base/api/webhooks/stripe/tenant-1',
    }]);
    expect(h.rows.map(({ key, ciphertext, maskedPreview }) => ({ key, ciphertext, maskedPreview }))).toEqual([
      { key: 'stripe.webhookSecret', ciphertext: 'encrypted:whsec_created', maskedPreview: '••••ated' },
      { key: 'stripe.restrictedKey', ciphertext: 'encrypted:rk_live_private', maskedPreview: '••••vate' },
    ]);
  });

  it('does not persist partial configuration when Stripe rejects webhook registration', async () => {
    const h = harness(payment(async () => err(integrationUnavailable('Stripe unavailable'))));

    await expect(configureStripe(
      { identity: identity('owner') },
      { restrictedKey: 'rk_test_private', mode: 'test' },
      h.deps,
    )).resolves.toEqual({
      ok: false,
      error: integrationUnavailable('Stripe unavailable'),
    });
    expect(h.rows).toEqual([]);
  });

  it.each([
    ['rk_test_private', 'test'],
    ['rk_live_private', 'live'],
  ] as const)('returns the mode %s carries without persisting a separate mode secret', async (restrictedKey, mode) => {
    const h = harness(payment(async () => ok({
      webhookEndpointId: 'we_created',
      webhookSecret: 'whsec_created',
    })));

    await expect(configureStripe(
      { identity: identity('owner') },
      { restrictedKey, mode },
      h.deps,
    )).resolves.toMatchObject({ ok: true, value: { mode } });
    expect(h.rows.map((row) => row.key)).toEqual(mode === 'test'
      ? ['stripe.testWebhookSecret', 'stripe.testRestrictedKey', 'stripe.testWebhookEndpointId']
      : ['stripe.webhookSecret', 'stripe.restrictedKey']);
  });

  it.each(['sk_test_private', 'rk_unknown_private'])(
    'rejects %s without calling the payment provider',
    async (restrictedKey) => {
      let calls = 0;
      const h = harness(payment(async () => {
        calls += 1;
        return ok({ webhookEndpointId: 'we_created', webhookSecret: 'whsec_created' });
      }));

      await expect(configureStripe(
        { identity: identity('owner') },
        { restrictedKey },
        h.deps,
      )).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
      expect(calls).toBe(0);
      expect(h.rows).toEqual([]);
    },
  );

  it('requires owner secret-write capability', async () => {
    const h = harness(payment(async () => ok({
      webhookEndpointId: 'we_created',
      webhookSecret: 'whsec_created',
    })));

    await expect(configureStripe(
      { identity: identity('admin') },
      { restrictedKey: 'rk_test_private', mode: 'test' },
      h.deps,
    )).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.rows).toEqual([]);
  });

  it('deletes the newly created endpoint when signing-secret persistence fails', async () => {
    const deleted: string[] = [];
    const h = harness(payment(
      async () => ok({ webhookEndpointId: 'we_created', webhookSecret: 'whsec_created' }),
      async (input) => {
        deleted.push(input.webhookEndpointId);
        return ok({ deleted: true });
      },
    ));
    h.deps.tenantSecrets.upsert = async () => {
      throw new Error('database unavailable');
    };

    await expect(configureStripe(
      { identity: identity('owner') },
      { restrictedKey: 'rk_test_private', mode: 'test' },
      h.deps,
    )).rejects.toThrow('database unavailable');
    expect(deleted).toEqual(['we_created']);
    expect(h.rows).toEqual([]);
  });
});

it.each([
  ['live', 'rk_test_wrong'],
  ['test', 'rk_live_wrong'],
] as const)('rejects a key from the other mode in the %s slot', async (mode, restrictedKey) => {
  let calls = 0;
  const h = harness(payment(async () => {
    calls += 1;
    return ok({ webhookEndpointId: 'we_unused', webhookSecret: 'whsec_unused' });
  }));
  expect(await configureStripe({ identity: identity('owner') }, { mode, restrictedKey }, h.deps))
    .toMatchObject({ ok: false, error: { code: 'validation' } });
  expect(calls).toBe(0);
  expect(h.rows).toEqual([]);
});

it('configures and removes a second endpoint without changing live credentials', async () => {
  const urls: string[] = [];
  const deleted: string[] = [];
  const h = harness(payment(async (input) => {
    urls.push(input.webhookUrl);
    return ok({ webhookEndpointId: `we_${urls.length}`, webhookSecret: `whsec_${urls.length}` });
  }, async (input) => { deleted.push(input.webhookEndpointId); return ok({ deleted: true }); }));
  h.deps.secretCrypto.decrypt = (encrypted) => ok(encrypted.ciphertext.replace('encrypted:', ''));
  h.deps.tenantSecrets.delete = async (tenantId, key) => {
    const index = h.rows.findIndex((row) => row.tenantId === tenantId && row.key === key);
    if (index < 0) return false;
    h.rows.splice(index, 1);
    return true;
  };
  await configureStripe({ identity: identity('owner') }, { restrictedKey: 'rk_live_private' }, h.deps);
  const live = structuredClone(h.rows);
  expect(await configureStripe({ identity: identity('owner') }, { mode: 'test', restrictedKey: 'rk_test_private' }, h.deps))
    .toMatchObject({ ok: true });
  expect(urls).toEqual([
    'https://app.example.test/base/api/webhooks/stripe/tenant-1',
    'https://app.example.test/base/api/webhooks/stripe/tenant-1?mode=test',
  ]);
  const { removeStripeTestMode } = await import('./configure-stripe.js');
  expect(await removeStripeTestMode({ identity: identity('owner') }, h.deps)).toEqual(ok({ removed: true }));
  expect(deleted).toEqual(['we_2']);
  expect(h.rows).toEqual(live);
});
