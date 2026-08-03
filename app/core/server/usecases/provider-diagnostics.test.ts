import { describe, expect, it } from 'vitest';

import type { Identity, StaffRole } from '#core/domain/index.js';
import { err, notFound, ok } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { PaymentProvider } from '../ports.js';
import { testIntegration, type TestIntegrationDeps } from './provider-diagnostics.js';

const ctx = (staffRole: StaffRole | null, tenantId: string | null = 't1'): Ctx => ({
  identity: {
    userId: 'u1',
    email: 'owner@together.dev',
    name: 'Owner',
    tenantId,
    tenantSlug: tenantId ? 'acme' : null,
    tenantName: tenantId ? 'Acme' : null,
    staffRole,
    memberId: null,
    memberBannedAt: null,
  } satisfies Identity,
});

const fakePayment = (
  tested: string[],
  options: { testFails?: boolean } = {},
): PaymentProvider => ({
  test: async () => {
    tested.push('payment');
    if (options.testFails) return err(notFound('No "stripe.restrictedKey" secret is configured'));
    return ok({
      code: 'payment.available',
      message: 'Stripe accepted the credentials and the test session was expired.',
    });
  },
  createCheckoutSession: async () =>
    ok({ url: 'https://fake.checkout.local/cs_test_1', sessionId: 'cs_test_1' }),
  expireCheckoutSession: async () => ok({ expired: true }),
  cancelSubscription: async () => ok({ canceled: true, alreadySettled: false }),
  verifyWebhookEvent: async () =>
    ok({ id: 'evt_1', type: 'checkout.session.completed', objectId: 'cs_1', checkoutSession: null }),
});

const fakeDeps = (
  tested: string[],
  options: { emailMissing?: boolean; sendFails?: boolean; testFails?: boolean } = {},
): TestIntegrationDeps => ({
  appBaseUrl: 'https://acme.together.dev',
  payment: fakePayment(tested, options),
  email: {
    send: async () => ok({ messageId: 'message-1' }),
    healthcheck: async () => ok({ healthy: true }),
    test: async () => {
      tested.push('email');
      if (options.testFails) return err(notFound('No email transport is configured'));
      return ok({ code: 'email.available', message: 'SMTP accepted the connection settings.' });
    },
  },
  emailSender: {
    send: async (message) => {
      tested.push(`email-send:${message.tenantId}:${message.to}`);
      return options.sendFails
        ? err(notFound('Platform email send failed'))
        : ok({ messageId: 'message-1', transport: 'platform' });
    },
  },
  emailTransports: {
    resolve: async (_tenantId, transport) => options.emailMissing ? null : ({
        send: async (message) => {
          tested.push(`${transport}-send:${message.to}`);
          return options.sendFails
            ? err(notFound(`${transport} send failed`))
            : ok({ messageId: `${transport}-message-1` });
        },
        healthcheck: async () => ok({ healthy: true }),
        test: async () => {
          tested.push(transport);
          return ok({ code: 'email.available', message: `${transport} accepted the settings.` });
        },
      }),
  },
  storage: {
    presignPut: (input) => ok(input.url),
    presignGet: (input) => ok(input.url),
    delete: async () => ok({ deleted: true }),
    healthcheck: async () => ok({ healthy: true }),
    test: async () => {
      tested.push('storage');
      if (options.testFails) return err(notFound('No "s3.accessKeyId" secret is configured'));
      return ok({ code: 'storage.available', message: 'Storage credentials are available.' });
    },
  },
});

describe('testIntegration', () => {
  it('dispatches storage, email and payment through the same diagnostic result', async () => {
    const tested: string[] = [];
    const deps = fakeDeps(tested);

    await expect(
      testIntegration(ctx('owner'), { provider: 'storage' }, deps),
    ).resolves.toMatchObject({ ok: true, value: { diagnostic: { code: 'storage.available' } } });
    await expect(testIntegration(ctx('owner'), { provider: 'email' }, deps)).resolves.toMatchObject({
      ok: true,
      value: { diagnostic: { code: 'email.available' } },
    });
    await expect(
      testIntegration(ctx('owner'), { provider: 'payment' }, deps),
    ).resolves.toMatchObject({ ok: true, value: { diagnostic: { code: 'payment.available' } } });

    expect(tested).toEqual(['storage', 'email', 'email-send:t1:owner@together.dev', 'payment']);
  });

  it('tests SMTP, SES and Resend and delivers each test message to the creator', async () => {
    const tested: string[] = [];
    const deps = fakeDeps(tested);

    for (const emailTransport of ['smtp', 'ses', 'resend'] as const) {
      await expect(
        testIntegration(ctx('owner'), { provider: 'email', emailTransport }, deps),
      ).resolves.toMatchObject({
        ok: true,
        value: { diagnostic: { code: 'email.available' } },
      });
    }

    expect(tested).toEqual([
      'smtp',
      'smtp-send:owner@together.dev',
      'ses',
      'ses-send:owner@together.dev',
      'resend',
      'resend-send:owner@together.dev',
    ]);
  });

  it('reports an unconfigured selected email transport without attempting a test or send', async () => {
    const tested: string[] = [];

    await expect(
      testIntegration(ctx('owner'), { provider: 'email', emailTransport: 'smtp' }, fakeDeps(tested, { emailMissing: true })),
    ).resolves.toMatchObject({ ok: false, error: { code: 'integration_not_configured' } });

    expect(tested).toEqual([]);
  });

  it('returns a send failure after a selected email transport passes diagnostics', async () => {
    const tested: string[] = [];

    await expect(
      testIntegration(ctx('owner'), { provider: 'email', emailTransport: 'resend' }, fakeDeps(tested, { sendFails: true })),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });

    expect(tested).toEqual(['resend', 'resend-send:owner@together.dev']);
  });

  it('returns a non-empty user-facing message for every provider', async () => {
    const deps = fakeDeps([]);
    for (const provider of ['storage', 'email', 'payment'] as const) {
      const result = await testIntegration(ctx('owner'), { provider }, deps);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.diagnostic.message.length).toBeGreaterThan(0);
    }
  });

  it('forbids an admin from testing any provider', async () => {
    const tested: string[] = [];
    const deps = fakeDeps(tested);
    for (const provider of ['storage', 'email', 'payment'] as const) {
      await expect(testIntegration(ctx('admin'), { provider }, deps)).resolves.toMatchObject({
        ok: false,
        error: { code: 'forbidden' },
      });
    }
    expect(tested).toEqual([]);
  });

  it('surfaces the adapter failure for every provider', async () => {
    const deps = fakeDeps([], { testFails: true });
    for (const provider of ['storage', 'email', 'payment'] as const) {
      await expect(testIntegration(ctx('owner'), { provider }, deps)).resolves.toMatchObject({
        ok: false,
        error: { code: 'not_found' },
      });
    }
  });

  it('requires a selected tenant', async () => {
    const deps = fakeDeps([]);
    await expect(
      testIntegration(ctx('owner', null), { provider: 'payment' }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });
});
