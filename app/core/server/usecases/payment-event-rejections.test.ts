import { describe, expect, it, vi } from 'vitest';

import {
  appError,
  err,
  internal,
  notFound,
  ok,
  paymentEventRejectedEmail,
  prerenderedTransactionalPayload,
  renderEmailOutboxPayload,
  tenantSettingsSchema,
  validation,
  type AppError,
  type Identity,
  type Order,
  type PaymentEventRejection,
  type Result,
  type StaffRole,
} from '#core/domain/index.js';

import type { EmailOutboxEnqueueInput, PaymentEventRejectionRepository, PaymentWebhookEvent } from '../ports.js';
import {
  listPaymentEventRejections,
  recordStripeWebhookOutcome,
  type PaymentEventRejectionDeps,
} from './payment-event-rejections.js';

const tenant = { id: 'tenant-acme', slug: 'acme', name: 'Acme' };

const createRejectionStore = () => {
  const rows = new Map<string, PaymentEventRejection>();
  const repository: PaymentEventRejectionRepository = {
    record: async (tenantId, rejection) => {
      const key = `${tenantId}:${rejection.eventId}`;
      const existing = rows.get(key);
      const { seenAt, ...fields } = rejection;
      const row: PaymentEventRejection = existing === undefined
        ? { tenantId, ...fields, firstSeenAt: seenAt, lastSeenAt: seenAt, attempts: 1, resolvedAt: null }
        : { ...existing, ...fields, lastSeenAt: seenAt, attempts: existing.attempts + 1, resolvedAt: null };
      rows.set(key, row);
      return row;
    },
    resolve: async (tenantId, eventId, resolvedAt) => {
      const existing = rows.get(`${tenantId}:${eventId}`);
      if (existing !== undefined && existing.resolvedAt === null) rows.set(`${tenantId}:${eventId}`, { ...existing, resolvedAt });
    },
    listUnresolved: async (tenantId, limit) =>
      [...rows.values()].filter((row) => row.tenantId === tenantId && row.resolvedAt === null).slice(0, limit),
  };
  return { rows, repository };
};

const paidCheckout = (overrides: Partial<PaymentWebhookEvent> = {}, paymentStatus: 'paid' | 'unpaid' | 'no_payment_required' | null = 'paid'): PaymentWebhookEvent => ({
  id: 'evt_paid',
  type: 'checkout.session.completed',
  objectId: 'cs_paid',
  livemode: true,
  mode: 'live',
  checkoutSession: {
    email: 'buyer@togethercommunity.app',
    paymentStatus,
    subscriptionId: null,
    paymentIntentId: 'pi_paid',
    metadata: { tenantId: tenant.id, productId: 'product-1', priceId: null, memberEmail: null, language: 'en' },
  },
  ...overrides,
});

const liveOrder: Order = {
  mode: 'live', id: 'order-1', tenantId: tenant.id, memberId: 'member-1', productId: 'product-1', priceId: null, kind: 'one_time',
  status: 'paid', amountCents: 4900, currency: 'PLN', provider: 'stripe', providerObjectIds: { checkoutSession: 'cs_paid' },
  couponId: null, discountCents: 0, createdAt: '2026-11-20T09:00:00.000Z',
};

const setup = (options: {
  order?: Order | null;
  staff?: Array<{ userId: string; email: string; staffRole: StaffRole; language: 'en' | 'pl' | null }>;
  supportEmail?: string;
} = {}) => {
  const store = createRejectionStore();
  const outbox = new Map<string, EmailOutboxEnqueueInput>();
  let now = '2026-11-20T10:00:00.000Z';
  const logger = { error: vi.fn<(message: string) => void>(), warn: vi.fn<(message: string) => void>() };
  const dispatchEmail = vi.fn<() => void>();
  let order = options.order ?? null;
  const findOrder = vi.fn(async (): Promise<Order | null> => order);
  const deps: PaymentEventRejectionDeps = {
    paymentEventRejections: store.repository,
    paymentRefunds: { findOrderByProviderObjectIds: findOrder },
    tenantAccess: {
      listStaffForTenant: async (tenantId) => tenantId === tenant.id ? options.staff ?? [
        { userId: 'owner-1', email: 'owner@togethercommunity.app', staffRole: 'owner', language: 'pl' },
        { userId: 'admin-1', email: 'admin@togethercommunity.app', staffRole: 'admin', language: 'en' },
      ] : [],
    },
    tenants: {
      findSettings: async () => options.supportEmail === undefined ? null : tenantSettingsSchema.parse({
        name: 'Acme', billingPortalUrl: null, bunnyStreamLibraryId: null, bunnyStreamCdnHostname: null,
        supportEmail: options.supportEmail, defaultLanguage: 'pl',
      }),
    },
    tenantDomains: { listByTenant: async () => [] },
    appBaseUrl: 'https://togethercommunity.app',
    baseDomain: 'togethercommunity.app',
    singleTenantMode: false,
    emailOutbox: {
      enqueue: async (input) => {
        if (!outbox.has(input.id)) outbox.set(input.id, input);
        return ok({ id: input.id });
      },
    },
    clock: { nowIso: () => now },
    logger,
    dispatchEmail,
  };
  return {
    deps, store, outbox, logger, dispatchEmail, findOrder,
    advance: (next: string) => { now = next; },
    setOrder: (next: Order | null) => { order = next; },
  };
};

type Outcome = Result<{ processed: boolean }, AppError>;

const refused: Outcome = err(validation('Checkout snapshot not found'));

describe('recordStripeWebhookOutcome', () => {
  it('records a refused paid checkout session, logs the operator marker and e-mails the workspace staff', async () => {
    const { deps, store, outbox, logger, dispatchEmail } = setup();

    await recordStripeWebhookOutcome(tenant, paidCheckout(), refused, deps);

    expect([...store.rows.values()]).toEqual([{
      tenantId: tenant.id,
      eventId: 'evt_paid',
      eventType: 'checkout.session.completed',
      checkoutSessionId: 'cs_paid',
      reasonCode: 'validation',
      reasonMessage: 'Checkout snapshot not found',
      firstSeenAt: '2026-11-20T10:00:00.000Z',
      lastSeenAt: '2026-11-20T10:00:00.000Z',
      attempts: 1,
      resolvedAt: null,
    }]);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      `[payment-webhook-rejected] tenant=${tenant.id} event=evt_paid type=checkout.session.completed reason=validation`,
    );
    expect([...outbox.values()].map((input) => [input.id, input.to])).toEqual([
      [`payment-event-rejected:${tenant.id}:evt_paid:0`, 'owner@togethercommunity.app'],
      [`payment-event-rejected:${tenant.id}:evt_paid:1`, 'admin@togethercommunity.app'],
    ]);
    const [queued] = [...outbox.values()];
    expect(queued).toMatchObject({ tenantId: tenant.id, onConflict: 'keep-existing', sourceApp: 'payment-event-rejections', tenantTransportRequired: false });
    const message = paymentEventRejectedEmail('pl', {
      tenantName: 'Acme',
      eventId: 'evt_paid',
      checkoutSessionId: 'cs_paid',
      reasonCode: 'validation',
      reasonMessage: 'Checkout snapshot not found',
      firstSeenAt: '2026-11-20T10:00:00.000Z',
      studioUrl: 'https://acme.togethercommunity.app/panel/sales',
    });
    expect(queued?.payload).toStrictEqual(prerenderedTransactionalPayload(message));
    expect(renderEmailOutboxPayload(queued?.payload).data).toStrictEqual(message);
    expect(paymentEventRejectedEmail('en', {
      tenantName: 'Acme', eventId: 'evt_paid', checkoutSessionId: 'cs_paid', reasonCode: 'validation',
      reasonMessage: 'Checkout snapshot not found', firstSeenAt: '2026-11-20T10:00:00.000Z', studioUrl: 'https://acme.togethercommunity.app/panel/sales',
    })).toStrictEqual(renderEmailOutboxPayload([...outbox.values()][1]?.payload).data);
    expect(dispatchEmail).toHaveBeenCalledTimes(1);
  });

  it('counts every retry of the same event and keeps the first sighting', async () => {
    const { deps, store, advance } = setup();

    await recordStripeWebhookOutcome(tenant, paidCheckout(), refused, deps);
    advance('2026-11-20T11:00:00.000Z');
    await recordStripeWebhookOutcome(tenant, paidCheckout(), refused, deps);
    advance('2026-11-20T13:00:00.000Z');
    await recordStripeWebhookOutcome(tenant, paidCheckout(), refused, deps);

    expect([...store.rows.values()]).toMatchObject([{
      eventId: 'evt_paid', attempts: 3, firstSeenAt: '2026-11-20T10:00:00.000Z', lastSeenAt: '2026-11-20T13:00:00.000Z',
    }]);
  });

  it('queues the staff e-mails only on the first refusal of an event', async () => {
    const { deps, outbox, dispatchEmail } = setup({ staff: [
      { userId: 'owner-1', email: 'owner@togethercommunity.app', staffRole: 'owner', language: null },
      { userId: 'owner-2', email: 'second-owner@togethercommunity.app', staffRole: 'owner', language: 'en' },
    ] });
    const enqueue = vi.spyOn(deps.emailOutbox, 'enqueue');
    const staffLookup = deps.tenantAccess === undefined ? undefined : vi.spyOn(deps.tenantAccess, 'listStaffForTenant');

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await recordStripeWebhookOutcome(tenant, paidCheckout(), refused, deps);
    }

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(staffLookup).toHaveBeenCalledTimes(1);
    expect(dispatchEmail).toHaveBeenCalledTimes(1);
    expect([...outbox.values()].map((input) => [input.id, input.to])).toEqual([
      [`payment-event-rejected:${tenant.id}:evt_paid:0`, 'owner@togethercommunity.app'],
      [`payment-event-rejected:${tenant.id}:evt_paid:1`, 'second-owner@togethercommunity.app'],
    ]);
  });

  it('sends the alert to the workspace support address when one is set', async () => {
    const { deps, outbox } = setup({ supportEmail: 'support@togethercommunity.app' });

    await recordStripeWebhookOutcome(tenant, paidCheckout(), refused, deps);

    expect([...outbox.values()].map((input) => [input.id, input.to, input.payload])).toEqual([
      [`payment-event-rejected:${tenant.id}:evt_paid:0`, 'support@togethercommunity.app', prerenderedTransactionalPayload(paymentEventRejectedEmail('pl', {
        tenantName: 'Acme', eventId: 'evt_paid', checkoutSessionId: 'cs_paid', reasonCode: 'validation',
        reasonMessage: 'Checkout snapshot not found', firstSeenAt: '2026-11-20T10:00:00.000Z', studioUrl: 'https://acme.togethercommunity.app/panel/sales',
      }))],
    ]);
  });

  it('reaches the admins of a workspace without a direct owner, once per address', async () => {
    const { deps, outbox } = setup({ staff: [
      { userId: 'admin-1', email: 'admin@togethercommunity.app', staffRole: 'admin', language: 'en' },
      { userId: 'admin-2', email: 'admin@togethercommunity.app', staffRole: 'admin', language: 'pl' },
      { userId: 'admin-3', email: 'second-admin@togethercommunity.app', staffRole: 'admin', language: null },
    ] });

    await recordStripeWebhookOutcome(tenant, paidCheckout(), refused, deps);

    expect([...outbox.values()].map((input) => input.to)).toEqual(['admin@togethercommunity.app', 'second-admin@togethercommunity.app']);
  });

  it('marks the record resolved when a later delivery of the same event succeeds', async () => {
    const { deps, store, advance } = setup();

    await recordStripeWebhookOutcome(tenant, paidCheckout(), refused, deps);
    advance('2026-11-21T09:00:00.000Z');
    await recordStripeWebhookOutcome(tenant, paidCheckout(), ok({ processed: true }), deps);

    expect([...store.rows.values()]).toMatchObject([{ eventId: 'evt_paid', attempts: 1, resolvedAt: '2026-11-21T09:00:00.000Z' }]);
    expect(await deps.paymentEventRejections.listUnresolved(tenant.id, 10)).toEqual([]);
  });

  it('keeps the record open when a later delivery is acknowledged without an order', async () => {
    const { deps, store, advance } = setup();

    await recordStripeWebhookOutcome(tenant, paidCheckout(), refused, deps);
    advance('2026-11-21T09:00:00.000Z');
    await recordStripeWebhookOutcome(tenant, paidCheckout(), ok({ processed: false }), deps);

    expect([...store.rows.values()]).toMatchObject([{ eventId: 'evt_paid', resolvedAt: null }]);
  });

  it('marks the record resolved when a later duplicate delivery finds the order already recorded', async () => {
    const { deps, store, advance, setOrder } = setup();

    await recordStripeWebhookOutcome(tenant, paidCheckout(), refused, deps);
    setOrder(liveOrder);
    advance('2026-11-21T09:00:00.000Z');
    await recordStripeWebhookOutcome(tenant, paidCheckout(), ok({ processed: false }), deps);

    expect([...store.rows.values()]).toMatchObject([{ eventId: 'evt_paid', resolvedAt: '2026-11-21T09:00:00.000Z' }]);
  });

  it('records a refused asynchronous payment that succeeded', async () => {
    const { deps, store } = setup();

    await recordStripeWebhookOutcome(tenant, paidCheckout({ id: 'evt_async', type: 'checkout.session.async_payment_succeeded' }), refused, deps);

    expect([...store.rows.values()].map((row) => [row.eventId, row.eventType])).toEqual([
      ['evt_async', 'checkout.session.async_payment_succeeded'],
    ]);
  });

  it('keeps the infrastructure detail of an internal failure out of the record and the e-mail', async () => {
    const { deps, store, outbox } = setup();

    await recordStripeWebhookOutcome(tenant, paidCheckout(), err(internal('Payment fulfillment failed: duplicate key buyer@togethercommunity.app')), deps);

    expect([...store.rows.values()]).toMatchObject([{ reasonCode: 'internal', reasonMessage: 'Payment processing failed unexpectedly' }]);
    expect(JSON.stringify([...outbox.values()])).not.toContain('buyer@togethercommunity.app');
  });

  it.each<[string, AppError, string]>([
    ['an interpolated not-found message', notFound('No published product "buyer@togethercommunity.app" in this tenant'), 'A record the payment refers to was not found'],
    ['an unknown validation message', validation('Unexpected value buyer@togethercommunity.app'), 'The payment did not pass validation'],
    ['a message of another code', appError('integration_unavailable', 'Provider said buyer@togethercommunity.app'), 'The payment could not be processed'],
  ])('stores and mails a fixed reason for %s', async (_label, error, reason) => {
    const { deps, store, outbox } = setup();

    await recordStripeWebhookOutcome(tenant, paidCheckout(), err(error), deps);

    expect([...store.rows.values()]).toMatchObject([{ reasonCode: error.code, reasonMessage: reason }]);
    expect([...outbox.values()].map((input) => renderEmailOutboxPayload(input.payload).data?.text)).toStrictEqual([expect.stringContaining(reason), expect.stringContaining(reason)]);
    expect(JSON.stringify([...store.rows.values(), ...outbox.values()])).not.toContain('buyer@togethercommunity.app');
  });

  it.each<[string, PaymentWebhookEvent, Outcome]>([
    ['an unpaid session', paidCheckout({}, 'unpaid'), refused],
    ['a session that needed no payment', paidCheckout({}, 'no_payment_required'), refused],
    ['a session without a payment status', paidCheckout({}, null), refused],
    ['a completed event without session data', paidCheckout({ checkoutSession: null }), err(validation('Stripe checkout event is missing session data'))],
    ['a test-mode session', paidCheckout({ id: 'test:evt_paid', mode: 'test', livemode: false }), refused],
    ['a live event delivered with livemode false', paidCheckout({ livemode: false }), refused],
    ['a foreign-tenant event', paidCheckout({ foreignTenant: true }), refused],
    ['a failed asynchronous payment', paidCheckout({ type: 'checkout.session.async_payment_failed' }), refused],
    ['an invoice event', { id: 'evt_invoice', type: 'invoice.paid', objectId: 'in_1', checkoutSession: null }, refused],
    ['a delivery another worker is still processing', paidCheckout(), err(appError('conflict', 'Payment event is being processed'))],
    ['an accepted delivery', paidCheckout(), ok({ processed: true })],
  ])('records nothing for %s', async (_label, event, outcome) => {
    const { deps, store, outbox, logger, dispatchEmail } = setup();

    await recordStripeWebhookOutcome(tenant, event, outcome, deps);

    expect(store.rows.size).toBe(0);
    expect(outbox.size).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
    expect(dispatchEmail).not.toHaveBeenCalled();
  });

  it('records nothing when the refused delivery already has an order for its checkout session', async () => {
    const { deps, store, outbox, findOrder } = setup({ order: liveOrder });

    await recordStripeWebhookOutcome(tenant, paidCheckout(), refused, deps);

    expect(findOrder).toHaveBeenCalledWith(tenant.id, { checkoutSession: 'cs_paid' }, 'live');
    expect(store.rows.size).toBe(0);
    expect(outbox.size).toBe(0);
  });

  it('resolves the record and e-mails nobody when a concurrent delivery commits the order while it is being recorded', async () => {
    const { deps, store, outbox, dispatchEmail, findOrder } = setup();
    findOrder.mockResolvedValueOnce(null).mockResolvedValue(liveOrder);

    await recordStripeWebhookOutcome(tenant, paidCheckout(), refused, deps);

    expect([...store.rows.values()]).toMatchObject([{ eventId: 'evt_paid', resolvedAt: '2026-11-20T10:00:00.000Z' }]);
    expect(outbox.size).toBe(0);
    expect(dispatchEmail).not.toHaveBeenCalled();
  });

  it('swallows a failing record write so the answer to Stripe stays the refusal', async () => {
    const { deps, logger, outbox } = setup();
    deps.paymentEventRejections.record = async () => { throw new Error('database unavailable'); };

    await expect(recordStripeWebhookOutcome(tenant, paidCheckout(), refused, deps)).resolves.toBeUndefined();

    expect(outbox.size).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      `[payment-webhook-rejected] tenant=${tenant.id} event=evt_paid type=checkout.session.completed reason=validation`,
    );
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(`[payment-webhook-rejected] record failed tenant=${tenant.id} event=evt_paid`));
  });

  it('swallows a failing resolve write so an accepted delivery stays accepted', async () => {
    const { deps, logger } = setup();
    deps.paymentEventRejections.resolve = async () => { throw new Error('database unavailable'); };

    await expect(recordStripeWebhookOutcome(tenant, paidCheckout(), ok({ processed: true }), deps)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(`[payment-webhook-rejected] resolve failed tenant=${tenant.id} event=evt_paid`));
  });
});

const identity = (staffRole: StaffRole | null, tenantId = tenant.id): Identity => ({
  userId: 'user-1',
  email: 'staff@togethercommunity.app',
  name: 'Staff',
  emailVerified: true,
  tenantAccess: staffRole === null ? 'member' : 'staff',
  tenantId,
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole,
  memberId: staffRole === null ? 'member-1' : null,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
});

describe('listPaymentEventRejections', () => {
  const seeded = async () => {
    const { deps } = setup();
    await recordStripeWebhookOutcome(tenant, paidCheckout(), refused, deps);
    await recordStripeWebhookOutcome({ ...tenant, id: 'tenant-studio', slug: 'studio' }, paidCheckout({ id: 'evt_studio' }), refused, deps);
    return deps;
  };

  it.each<StaffRole>(['owner', 'admin'])('lists the unresolved records of the workspace for an %s', async (staffRole) => {
    const deps = await seeded();

    const result = await listPaymentEventRejections({ identity: identity(staffRole) }, {}, deps);

    expect(result).toMatchObject({ ok: true, value: { rejections: [{ tenantId: tenant.id, eventId: 'evt_paid', attempts: 1 }] } });
    expect(result.ok && result.value.rejections).toHaveLength(1);
  });

  it('forbids a member without the reconciliation capability', async () => {
    const deps = await seeded();

    expect(await listPaymentEventRejections({ identity: identity(null) }, {}, deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('refuses an invalid limit', async () => {
    const deps = await seeded();

    expect(await listPaymentEventRejections({ identity: identity('owner') }, { limit: 0 }, deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
