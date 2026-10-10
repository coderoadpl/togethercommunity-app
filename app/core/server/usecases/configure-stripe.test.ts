import { createInMemoryTenantDomainRepository, tenantDomainFixture } from '../testing/tenant-domain-fakes.js';
import { probeStripePermissions } from './probe-stripe-permissions.js';
import { describe, expect, it, vi } from 'vitest';

import {
  err,
  integrationUnavailable,
  ok,
  type Identity,
  type StripePermissionCheck,
  type TenantSecret,
} from '#core/domain/index.js';

import type { PaymentProvider } from '../ports.js';
import { operatorCtx } from '../testing/operator-tenant-fakes.js';
import { createTenantSecretRepositoryFake } from '../testing/tenant-secret-fake.js';
import { configureStripe, type ConfigureStripeDeps } from './configure-stripe.js';
import { getOperatorTenantReadiness } from './operator-tenant-readiness.js';

const identity = (staffRole: Identity['staffRole']): Identity => ({
  userId: 'owner-1',
  email: 'owner@example.test',
  name: 'Owner',
  emailVerified: true,
  tenantAccess: staffRole === null ? 'member' : 'staff',
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

const harness = (
  provider: PaymentProvider,
  initial: readonly TenantSecret[] = [],
): ReturnType<typeof createTenantSecretRepositoryFake> & { deps: ConfigureStripeDeps } => {
  const tenantSecrets = createTenantSecretRepositoryFake(initial);
  let id = 0;
  return {
    ...tenantSecrets,
    deps: {
      appBaseUrl: 'https://app.example.test/base',
      baseDomain: 'example.test',
      singleTenantMode: false,
      payment: provider,
      tenantSecrets: tenantSecrets.repository,
      secretCrypto: {
        encrypt: (plaintext) => ({ ciphertext: `encrypted:${plaintext}`, iv: 'iv', authTag: 'tag' }),
        decrypt: () => { throw new Error('unused'); },
      },
      ids: { nextId: () => `secret-${id += 1}` },
      clock: { nowIso: () => '2026-08-03T12:00:00.000Z' },
    },
  };
};

const previousLiveConfiguration = (): TenantSecret[] => {
  const values = [
    ['stripe.webhookSecret', 'encrypted:whsec_previous'],
    ['stripe.restrictedKey', 'encrypted:rk_live_previous'],
    ['stripe.webhookEndpointId', 'encrypted:we_previous'],
  ] as const;
  return values.map(([key, ciphertext], index) => ({
    id: `previous-${String(index)}`,
    tenantId: 'tenant-1',
    key,
    ciphertext,
    iv: 'iv',
    authTag: 'tag',
    maskedPreview: '••••ious',
    updatedAt: '2026-08-02T12:00:00.000Z',
  }));
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
        webhookUrl: 'https://acme.example.test/api/webhooks/stripe/tenant-1',
      },
    });
    expect(calls).toEqual([{
      tenantId: 'tenant-1',
      restrictedKey: 'rk_live_private',
      webhookUrl: 'https://acme.example.test/api/webhooks/stripe/tenant-1',
    }]);
    expect(h.rows.map(({ key, ciphertext, maskedPreview }) => ({ key, ciphertext, maskedPreview }))).toEqual([
      { key: 'stripe.webhookSecret', ciphertext: 'encrypted:whsec_created', maskedPreview: '••••ated' },
      { key: 'stripe.restrictedKey', ciphertext: 'encrypted:rk_live_private', maskedPreview: '••••vate' },
      { key: 'stripe.webhookEndpointId', ciphertext: 'encrypted:we_created', maskedPreview: '••••ated' },
    ]);
  });

  it('registers the webhook on APP_BASE_URL in single-tenant mode', async () => {
    const calls: Parameters<NonNullable<PaymentProvider['configureWebhook']>>[0][] = [];
    const h = harness(payment(async (input) => {
      calls.push(input);
      return ok({ webhookEndpointId: 'we_created', webhookSecret: 'whsec_created' });
    }));
    h.deps.appBaseUrl = 'https://learn.example.test/base';
    h.deps.singleTenantMode = true;

    await expect(configureStripe(
      { identity: identity('owner') },
      { restrictedKey: 'rk_test_private', mode: 'test' },
      h.deps,
    )).resolves.toMatchObject({
      ok: true,
      value: { webhookUrl: 'https://learn.example.test/api/webhooks/stripe/tenant-1?mode=test' },
    });
    expect(calls).toMatchObject([{
      tenantId: 'tenant-1',
      webhookUrl: 'https://learn.example.test/api/webhooks/stripe/tenant-1?mode=test',
    }]);
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
      : ['stripe.webhookSecret', 'stripe.restrictedKey', 'stripe.webhookEndpointId']);
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

  it.each([0, 1, 2])(
    'keeps the previous stored configuration when atomic persistence fails at position %s',
    async (failurePosition) => {
      const deleted: string[] = [];
      const previous = previousLiveConfiguration();
      const h = harness(payment(
        async () => ok({ webhookEndpointId: 'we_created', webhookSecret: 'whsec_created' }),
        async (input) => {
          deleted.push(input.webhookEndpointId);
          return ok({ deleted: true });
        },
      ), previous);
      h.failNextBatchAt(failurePosition);

      await expect(configureStripe(
        { identity: identity('owner') },
        { restrictedKey: 'rk_live_private' },
        h.deps,
      )).rejects.toThrow(`tenant secret batch failed at ${String(failurePosition)}`);
      expect(deleted).toEqual(['we_created']);
      expect(h.rows).toEqual(previous);
      const readiness = await getOperatorTenantReadiness(operatorCtx, { slug: 'acme' }, {
        tenants: {
          findBySlug: async () => ({
            id: 'tenant-1', slug: 'acme', name: 'Acme', status: 'active',
            plan: 'self_hosted', contentVersion: 1,
          }),
          findSettings: async () => null,
        },
        tenantAccess: { listStaffForTenant: async () => [] },
        tenantSecrets: h.repository,
        storageCorsCache: { read: async () => null },
        products: { listPublishedByTenant: async () => [] },
      });
      expect(readiness).toMatchObject({
        ok: true,
        value: { stripeConfigured: true, mode: 'live', webhookEndpointRegistered: true },
      });
    },
  );

  it('cleans up a first-time test endpoint when atomic persistence fails', async () => {
    const deleted: string[] = [];
    const h = harness(payment(
      async () => ok({ webhookEndpointId: 'we_created', webhookSecret: 'whsec_created' }),
      async (input) => {
        deleted.push(input.webhookEndpointId);
        return ok({ deleted: true });
      },
    ));
    h.failNextBatchAt(1);

    await expect(configureStripe(
      { identity: identity('owner') },
      { restrictedKey: 'rk_test_private', mode: 'test' },
      h.deps,
    )).rejects.toThrow('tenant secret batch failed at 1');
    expect(deleted).toEqual(['we_created']);
    expect(h.rows).toEqual([]);
  });

  it('replaces all three records during a successful reconfiguration', async () => {
    const h = harness(payment(async () => ok({
      webhookEndpointId: 'we_reconfigured',
      webhookSecret: 'whsec_reconfigured',
    })), previousLiveConfiguration());

    await expect(configureStripe(
      { identity: identity('owner') },
      { restrictedKey: 'rk_live_reconfigured' },
      h.deps,
    )).resolves.toMatchObject({ ok: true });

    expect(h.rows.map(({ key, ciphertext }) => ({ key, ciphertext }))).toEqual([
      { key: 'stripe.webhookSecret', ciphertext: 'encrypted:whsec_reconfigured' },
      { key: 'stripe.restrictedKey', ciphertext: 'encrypted:rk_live_reconfigured' },
      { key: 'stripe.webhookEndpointId', ciphertext: 'encrypted:we_reconfigured' },
    ]);
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
    'https://acme.example.test/api/webhooks/stripe/tenant-1',
    'https://acme.example.test/api/webhooks/stripe/tenant-1?mode=test',
  ]);
  const { removeStripeTestMode } = await import('./configure-stripe.js');
  expect(await removeStripeTestMode({ identity: identity('owner') }, h.deps)).toEqual(ok({ removed: true }));
  expect(deleted).toEqual(['we_2']);
  expect(h.rows).toEqual(live);
});

describe('probeStripePermissions', () => {
  const identity: Identity = {
    userId: 'owner-1', email: 'owner@example.test', name: 'Owner', emailVerified: true,
    tenantAccess: 'staff', tenantId: 'tenant-1', tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner',
    memberId: null, image: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null,
    memberLanguage: null, memberVideoAutoplay: false,
  };

  const harness = (checks: StripePermissionCheck[] = []) => {
    const probe = vi.fn<NonNullable<PaymentProvider['probeStripePermissions']>>(async () => ok(checks));
    const payment: PaymentProvider = {
      probeStripePermissions: probe,
      createCheckoutSession: async () => { throw new Error('unused'); },
      expireCheckoutSession: async () => { throw new Error('unused'); },
      cancelSubscription: async () => { throw new Error('unused'); },
      verifyWebhookEvent: async () => { throw new Error('unused'); },
      test: async () => { throw new Error('unused'); },
    };
    return { probe, deps: {
      payment, clock: { nowIso: () => '2026-10-10T12:00:00.000Z' },
      appBaseUrl: 'https://app.example.test', baseDomain: 'example.test', singleTenantMode: false,
      tenantDomains: createInMemoryTenantDomainRepository([
        tenantDomainFixture({ id: 'domain-1', tenantId: 'tenant-1', domain: 'learn.example.test', verified: true }),
      ]),
    } };
  };

  it('passes the canonical custom origin, tenant and requested mode to the provider', async () => {
    const h = harness([{ resource: 'Subscriptions', permission: 'read', status: 'ok' }]);
    expect(await probeStripePermissions({ identity }, { mode: 'test' }, h.deps)).toEqual(ok({
      mode: 'test', checks: [{ resource: 'Subscriptions', permission: 'read', status: 'ok' }],
      allOk: true, checkedAt: '2026-10-10T12:00:00.000Z',
    }));
    expect(h.probe).toHaveBeenCalledExactlyOnceWith({
      tenantId: 'tenant-1', mode: 'test', origin: 'https://learn.example.test',
    });
  });

  it.each(['missing', 'error'] as const)('makes allOk false for a %s check', async (status) => {
    const h = harness([{ resource: 'Coupons', permission: 'write', status, detail: 'Rejected' }]);
    expect(await probeStripePermissions({ identity }, { mode: 'live' }, h.deps))
      .toMatchObject({ ok: true, value: { allOk: false } });
  });

  it.each(['admin', null] as const)('rejects role %s before probing Stripe', async (staffRole) => {
    const h = harness();
    expect(await probeStripePermissions({ identity: { ...identity, staffRole, tenantAccess: staffRole === null ? 'member' : 'staff' } }, { mode: 'live' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.probe).not.toHaveBeenCalled();
  });

  it('propagates an unavailable stored key', async () => {
    const h = harness();
    h.probe.mockResolvedValue(err(integrationUnavailable('The restricted key is not configured')));
    expect(await probeStripePermissions({ identity }, { mode: 'live' }, h.deps))
      .toEqual(err(integrationUnavailable('The restricted key is not configured')));
  });
});
