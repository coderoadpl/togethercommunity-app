import { describe, expect, it } from 'vitest';

import {
  err,
  ok,
  SMOKE_TENANT_ID,
  SmokeTenantReseedRefused,
  validation,
  type PlatformAuditEvent,
} from '#core/domain/index.js';

import type { PaymentProvider } from '../ports.js';
import { createTenantSecretRepositoryFake } from '../testing/tenant-secret-fake.js';
import {
  reseedSmokeTenant,
  type SmokeTenantReseedDeps,
  type SmokeTenantTestPaymentsDeps,
} from './smoke-tenant-reseed.js';

const deps = (
  run: SmokeTenantReseedDeps['reseed']['run'],
): { deps: SmokeTenantReseedDeps; recorded: PlatformAuditEvent[] } => {
  const recorded: PlatformAuditEvent[] = [];
  return {
    recorded,
    deps: {
      reseed: { run },
      platformAudit: {
        record: async (event) => {
          recorded.push(event);
        },
      },
      environment: 'production',
      ids: { nextId: () => 'audit-1' },
      clock: { nowIso: () => '2026-09-05T12:00:00.000Z' },
    },
  };
};

describe('reseedSmokeTenant', () => {
  it('reports the wipe and records a reseed-acme audit event', async () => {
    const harness = deps(async () => ({
      tenantId: SMOKE_TENANT_ID,
      wiped: [{ table: 'members', rows: 2 }],
    }));

    const result = await reseedSmokeTenant(harness.deps);

    expect(result).toEqual({
      ok: true,
      value: {
        tenantId: SMOKE_TENANT_ID,
        environment: 'production',
        durationMs: 0,
        wiped: [{ table: 'members', rows: 2 }],
        testPayments: 'not-configured',
      },
    });
    expect(harness.recorded).toEqual([expect.objectContaining({
      action: 'reseed-acme',
      environment: 'production',
      status: 'succeeded',
      detail: null,
    })]);
  });

  it('reports a refusal to the caller instead of an infrastructure failure', async () => {
    const harness = deps(async () => {
      throw new SmokeTenantReseedRefused(
        'Smoke tenant reseed refused because tenant-acme has a member outside @together.dev',
      );
    });

    const result = await reseedSmokeTenant(harness.deps);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'conflict',
        message: expect.stringContaining('has a member outside @together.dev'),
      },
    });
    expect(harness.recorded).toEqual([expect.objectContaining({
      action: 'reseed-acme',
      status: 'failed',
      detail: expect.stringContaining('outside @together.dev'),
    })]);
  });

  it('keeps an unexpected failure opaque', async () => {
    const harness = deps(async () => {
      throw new Error('connection terminated unexpectedly');
    });

    const result = await reseedSmokeTenant(harness.deps);

    expect(result).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Smoke tenant reseed failed' },
    });
    expect(harness.recorded).toEqual([expect.objectContaining({
      status: 'failed',
      detail: 'connection terminated unexpectedly',
    })]);
  });
});

type ConfigureWebhook = NonNullable<PaymentProvider['configureWebhook']>;
type DeleteWebhookEndpoint = NonNullable<PaymentProvider['deleteWebhookEndpoint']>;

const unused = async (): Promise<never> => { throw new Error('unused'); };

const testPaymentsHarness = (
  configureWebhook: ConfigureWebhook,
  restrictedKey = 'rk_test_purchase',
) => {
  const tenantSecrets = createTenantSecretRepositoryFake();
  const registered: Parameters<ConfigureWebhook>[0][] = [];
  const deleted: Parameters<DeleteWebhookEndpoint>[0][] = [];
  const testPayments: SmokeTenantTestPaymentsDeps = {
    restrictedKey,
    configure: {
      appBaseUrl: 'https://app.example.test',
      baseDomain: 'example.test',
      singleTenantMode: false,
      payment: {
        configureWebhook: async (input) => {
          registered.push(input);
          return configureWebhook(input);
        },
        deleteWebhookEndpoint: async (input) => {
          deleted.push(input);
          return ok({ deleted: true });
        },
        createCheckoutSession: unused,
        expireCheckoutSession: unused,
        cancelSubscription: unused,
        verifyWebhookEvent: unused,
        test: unused,
      },
      tenantSecrets: tenantSecrets.repository,
      secretCrypto: {
        encrypt: (plaintext) => ({ ciphertext: `encrypted:${plaintext}`, iv: 'iv', authTag: 'tag' }),
        decrypt: () => { throw new Error('unused'); },
      },
      ids: { nextId: () => 'secret-id' },
      clock: { nowIso: () => '2026-09-05T12:00:00.000Z' },
    },
  };
  return { tenantSecrets, registered, deleted, testPayments };
};

const reseeded = async () => ({ tenantId: SMOKE_TENANT_ID, wiped: [{ table: 'members', rows: 2 }] });

describe('reseedSmokeTenant test payments', () => {
  it('configures the test slot of the smoke tenant after the reseed', async () => {
    const order: string[] = [];
    const payments = testPaymentsHarness(async () => {
      order.push('configure');
      return ok({ webhookEndpointId: 'we_test', webhookSecret: 'whsec_test' });
    });
    const harness = deps(async () => {
      order.push('reseed');
      return reseeded();
    });

    const result = await reseedSmokeTenant({ ...harness.deps, testPayments: payments.testPayments });

    expect(result).toMatchObject({ ok: true, value: { testPayments: 'configured' } });
    expect(order).toEqual(['reseed', 'configure']);
    expect(payments.registered).toEqual([{
      tenantId: SMOKE_TENANT_ID,
      restrictedKey: 'rk_test_purchase',
      webhookUrl: `https://acme.example.test/api/webhooks/stripe/${SMOKE_TENANT_ID}?mode=test`,
    }]);
    expect(payments.tenantSecrets.rows.map(({ tenantId, key, ciphertext }) => ({ tenantId, key, ciphertext }))).toEqual([
      { tenantId: SMOKE_TENANT_ID, key: 'stripe.testWebhookSecret', ciphertext: 'encrypted:whsec_test' },
      { tenantId: SMOKE_TENANT_ID, key: 'stripe.testRestrictedKey', ciphertext: 'encrypted:rk_test_purchase' },
      { tenantId: SMOKE_TENANT_ID, key: 'stripe.testWebhookEndpointId', ciphertext: 'encrypted:we_test' },
    ]);
    expect(harness.recorded).toEqual([expect.objectContaining({
      action: 'reseed-acme',
      status: 'succeeded',
      detail: 'test payments configured',
    })]);
  });

  it('reports a provider failure by its code without its text and keeps the reseed', async () => {
    const providerText = 'Stripe rejected webhook registration: https://acme.example.test/api/webhooks/stripe/tenant-acme?mode=test';
    const payments = testPaymentsHarness(async () => err(validation(providerText)));
    const harness = deps(reseeded);

    const result = await reseedSmokeTenant({ ...harness.deps, testPayments: payments.testPayments });

    expect(result).toEqual({
      ok: true,
      value: {
        tenantId: SMOKE_TENANT_ID,
        environment: 'production',
        durationMs: 0,
        wiped: [{ table: 'members', rows: 2 }],
        testPayments: 'failed',
      },
    });
    expect(JSON.stringify(result)).not.toContain('Stripe rejected');
    expect(harness.recorded).toEqual([expect.objectContaining({
      status: 'succeeded',
      detail: 'test payments failed: validation',
    })]);
    expect(payments.tenantSecrets.rows).toEqual([]);
  });

  it('removes the new endpoint and keeps the reseed when storing the secrets fails', async () => {
    const payments = testPaymentsHarness(async () => ok({ webhookEndpointId: 'we_test', webhookSecret: 'whsec_test' }));
    payments.tenantSecrets.failNextBatchAt(1);
    const harness = deps(reseeded);

    const result = await reseedSmokeTenant({ ...harness.deps, testPayments: payments.testPayments });

    expect(result).toMatchObject({ ok: true, value: { testPayments: 'failed' } });
    expect(payments.deleted).toEqual([{ restrictedKey: 'rk_test_purchase', webhookEndpointId: 'we_test' }]);
    expect(payments.tenantSecrets.rows).toEqual([]);
    expect(harness.recorded).toEqual([expect.objectContaining({
      status: 'succeeded',
      detail: 'test payments failed: internal',
    })]);
  });

  it('never writes the live slot, even when handed a live key', async () => {
    const payments = testPaymentsHarness(
      async () => ok({ webhookEndpointId: 'we_live', webhookSecret: 'whsec_live' }),
      'rk_live_purchase',
    );
    const harness = deps(reseeded);

    const result = await reseedSmokeTenant({ ...harness.deps, testPayments: payments.testPayments });

    expect(result).toMatchObject({ ok: true, value: { testPayments: 'failed' } });
    expect(payments.registered).toEqual([]);
    expect(payments.tenantSecrets.rows).toEqual([]);
  });

  it('configures nothing when the reseed fails', async () => {
    const payments = testPaymentsHarness(async () => ok({ webhookEndpointId: 'we_test', webhookSecret: 'whsec_test' }));
    const harness = deps(async () => {
      throw new Error('connection terminated unexpectedly');
    });

    const result = await reseedSmokeTenant({ ...harness.deps, testPayments: payments.testPayments });

    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(payments.registered).toEqual([]);
  });
});
