import { describe, expect, it } from 'vitest';

import type { Identity, StaffRole } from '#core/domain/index.js';
import { err, notFound, ok } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { PaymentProvider } from '../ports.js';
import { testStripeConnection } from './payment-integrations.js';

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
  } satisfies Identity,
});

interface FakeCalls {
  created: number;
  expired: string[];
}

const fakePayment = (
  calls: FakeCalls,
  options: { createFails?: boolean } = {},
): PaymentProvider => ({
  createCheckoutSession: async () => {
    calls.created += 1;
    if (options.createFails) return err(notFound('No "stripe.restrictedKey" secret is configured'));
    return ok({ url: 'https://fake.checkout.local/cs_test_1', sessionId: 'cs_test_1' });
  },
  expireCheckoutSession: async (input) => {
    calls.expired.push(input.sessionId);
    return ok({ expired: true });
  },
  cancelSubscription: async () => ok({ canceled: true, alreadySettled: false }),
  verifyWebhookEvent: async () =>
    ok({ id: 'evt_1', type: 'checkout.session.completed', objectId: 'cs_1', checkoutSession: null }),
});

describe('testStripeConnection', () => {
  it('creates and immediately expires a session for the owner', async () => {
    const calls: FakeCalls = { created: 0, expired: [] };
    const result = await testStripeConnection(
      ctx('owner'),
      { appBaseUrl: 'https://acme.together.dev' },
      fakePayment(calls),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ok).toBe(true);
    expect(result.value.diagnostic.length).toBeGreaterThan(0);
    expect(calls.created).toBe(1);
    expect(calls.expired).toEqual(['cs_test_1']);
  });

  it('forbids an admin from testing the connection', async () => {
    const calls: FakeCalls = { created: 0, expired: [] };
    const result = await testStripeConnection(
      ctx('admin'),
      { appBaseUrl: 'https://acme.together.dev' },
      fakePayment(calls),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(calls.created).toBe(0);
  });

  it('surfaces a readable diagnostic when no key is configured', async () => {
    const calls: FakeCalls = { created: 0, expired: [] };
    const result = await testStripeConnection(
      ctx('owner'),
      { appBaseUrl: 'https://acme.together.dev' },
      fakePayment(calls, { createFails: true }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(calls.expired).toHaveLength(0);
  });

  it('requires a selected tenant', async () => {
    const calls: FakeCalls = { created: 0, expired: [] };
    const result = await testStripeConnection(
      ctx('owner', null),
      { appBaseUrl: 'https://acme.together.dev' },
      fakePayment(calls),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });
});
