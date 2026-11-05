import { describe, expect, it, vi } from 'vitest';

import {
  err,
  integrationUnavailable,
  internal,
  ok,
  type CheckoutSnapshot,
  type EmailOutboxPayload,
  type Identity,
  type Product,
  type TenantSecret,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { PaymentProvider } from '../ports.js';
import { createStockRepositoryFake } from '../testing/stock-fake.js';
import { createCheckoutSession, startCheckoutSession, validateCheckoutSelection, type CheckoutDeps } from './checkout.js';
import {
  adjustProductStock,
  commitCheckoutStock,
  enableProductStock,
  getProductStock,
  releaseExpiredStockReservations,
  setProductStockThreshold,
  type CommitCheckoutStockDeps,
} from './stock.js';

const now = '2026-11-05T10:00:00.000Z';
const tenant = { id: 'tenant-a', slug: 'alpha', name: 'Alpha', status: 'active' as const, plan: 'hosted' as const, contentVersion: 1 };

const poster: Product = {
  id: 'poster',
  tenantId: tenant.id,
  type: 'physical',
  deliveryMethod: 'pickup',
  slug: 'poster',
  title: 'Printed poster',
  description: '',
  coverUrl: null,
  priceCents: 4900,
  currency: 'PLN',
  visibility: 'listed',
  published: true,
  accessItems: [],
  legacyId: null,
  createdAt: now,
};

const secret = (key: TenantSecret['key']): TenantSecret => ({
  id: key, tenantId: tenant.id, key, ciphertext: 'ciphertext', iv: 'iv', authTag: 'tag', maskedPreview: 'masked', updatedAt: now,
});

const productRepository = (items: Product[]): CheckoutDeps['products'] => ({
  listByTenant: async () => items,
  listPublishedByTenant: async () => items,
  findById: async (_tenantId, id) => items.find((item) => item.id === id) ?? null,
  create: async () => 'created',
  updateAccessItems: async () => null,
  setPublished: async () => undefined,
  bumpContentVersion: async () => undefined,
});

const checkoutHarness = (items: Product[] = [poster]) => {
  const stock = createStockRepositoryFake();
  const snapshots = new Map<string, CheckoutSnapshot>();
  let sequence = 0;
  const createSession = vi.fn<PaymentProvider['createCheckoutSession']>(async () => ok({ url: 'https://checkout.stripe.test/session', sessionId: 'cs-1' }));
  const deps: CheckoutDeps = {
    products: productRepository(items),
    prices: { listByProduct: async () => [], listActiveByProducts: async () => [], findById: async () => null, create: async () => undefined, setActive: async () => null },
    tenantSecrets: { listByTenant: async () => [], findByKey: async (_tenantId, key) => secret(key), upsert: async (_tenantId, value) => value, upsertMany: async (_tenantId, values) => [...values], delete: async () => false },
    payment: {
      test: async () => ok({ code: 'payment.available', message: 'ok' }),
      createCheckoutSession: createSession,
      expireCheckoutSession: async () => ok({ expired: true }),
      cancelSubscription: async () => ok({ canceled: true, alreadySettled: false }),
      verifyWebhookEvent: async () => ok({ id: 'evt', type: 'ignored', objectId: null, checkoutSession: null }),
    },
    checkoutSnapshots: {
      create: async (_tenantId, snapshot) => { snapshots.set(snapshot.id, snapshot); },
      attachProviderSession: async () => undefined,
      findById: async (_tenantId, id) => snapshots.get(id) ?? null,
    },
    orders: { create: async () => undefined, completeTestCheckout: async () => null, list: async () => ({ orders: [], total: 0 }), revenueSince: async () => [], countSince: async () => 0, listPaidWithoutGrant: async () => [] },
    ids: { nextId: () => { sequence += 1; return `id-${String(sequence)}`; } },
    clock: { nowIso: () => now },
    stock: stock.repository,
  };
  return { deps, stock, createSession, snapshots };
};

const staffCtx = (role: 'admin' | null = 'admin'): Ctx => {
  const identity: Identity = {
    userId: 'staff-user', email: 'staff@example.com', name: 'Staff', emailVerified: true, image: null,
    tenantAccess: role === null ? 'member' : 'staff', tenantId: tenant.id, tenantSlug: tenant.slug, tenantName: tenant.name,
    staffRole: role, memberId: role === null ? 'member-1' : null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null,
    memberVideoAutoplay: null,
  };
  return { identity };
};

const alertHarness = () => {
  const stock = createStockRepositoryFake();
  const queued: { to: string; payload: EmailOutboxPayload }[] = [];
  const warnings: string[] = [];
  let sequence = 0;
  const deps: CommitCheckoutStockDeps = {
    stock: stock.repository,
    tenantAccess: { listStaffForTenant: async () => [{ userId: 'owner', email: 'owner@example.com', staffRole: 'owner', language: 'en' }] },
    tenants: { findSettings: async () => null },
    products: productRepository([poster]),
    emailOutbox: { enqueue: async (message) => { queued.push({ to: message.to, payload: message.payload }); return ok({ id: message.id }); } },
    ids: { nextId: () => { sequence += 1; return `mail-${String(sequence)}`; } },
    clock: { nowIso: () => now },
    logger: { warn: (message: string) => { warnings.push(message); } },
    appBaseUrl: 'https://together.example.com',
    baseDomain: 'together.example.com',
    singleTenantMode: false,
    tenantDomains: { listByTenant: async () => [] },
  };
  const commit = (orderId: string, checkoutSnapshotId: string | null = null) =>
    commitCheckoutStock(tenant, { checkoutSnapshotId, orderId, productIds: [poster.id] }, deps);
  return { stock, queued, warnings, deps, commit };
};

describe('checkout stock reservations', () => {
  it('reserves a tracked product, shortens the Stripe session to 31 minutes and holds the piece for 36', async () => {
    const h = checkoutHarness();
    h.stock.track(tenant.id, poster.id, 1);
    const started = await createCheckoutSession(tenant, 'https://alpha.example.com', { productId: poster.id }, h.deps);
    expect(started.ok).toBe(true);
    expect(h.createSession).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: '2026-11-05T10:31:00.000Z' }));
    expect(h.stock.reservations).toEqual([expect.objectContaining({ productId: poster.id, status: 'active', expiresAt: '2026-11-05T10:36:00.000Z' })]);
    expect(h.stock.levels.get(tenant.id, poster.id)).toMatchObject({ onHand: 1, reserved: 1 });
  });

  it('keeps the default Stripe expiry for an untracked product', async () => {
    const h = checkoutHarness();
    expect((await createCheckoutSession(tenant, 'https://alpha.example.com', { productId: poster.id }, h.deps)).ok).toBe(true);
    expect(h.createSession.mock.calls[0]?.[0]).not.toHaveProperty('expiresAt');
    expect(h.stock.reservations).toEqual([]);
  });

  it('releases the reservation when Stripe session creation fails', async () => {
    const h = checkoutHarness();
    h.stock.track(tenant.id, poster.id, 1);
    h.createSession.mockResolvedValueOnce(err(integrationUnavailable('Stripe is down')));
    const started = await createCheckoutSession(tenant, 'https://alpha.example.com', { productId: poster.id }, h.deps);
    expect(started).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    expect(h.stock.reservations).toEqual([expect.objectContaining({ status: 'released' })]);
    expect(h.stock.levels.get(tenant.id, poster.id)).toMatchObject({ onHand: 1, reserved: 0 });
  });

  it('releases the reservation and rethrows when Stripe session creation throws', async () => {
    const h = checkoutHarness();
    h.stock.track(tenant.id, poster.id, 1);
    h.createSession.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(createCheckoutSession(tenant, 'https://alpha.example.com', { productId: poster.id }, h.deps)).rejects.toThrow('socket hang up');
    expect(h.stock.levels.get(tenant.id, poster.id)).toMatchObject({ reserved: 0 });
  });

  it('expires the Stripe session and releases the reservation when recording the session fails', async () => {
    const h = checkoutHarness();
    h.stock.track(tenant.id, poster.id, 1);
    const expire = vi.fn<PaymentProvider['expireCheckoutSession']>(async () => ok({ expired: true }));
    h.deps.payment.expireCheckoutSession = expire;
    h.deps.checkoutSnapshots = { ...h.deps.checkoutSnapshots ?? { create: async () => undefined, findById: async () => null, attachProviderSession: async () => undefined }, attachProviderSession: async () => { throw new Error('database unavailable'); } };
    await expect(createCheckoutSession(tenant, 'https://alpha.example.com', { productId: poster.id }, h.deps)).rejects.toThrow('database unavailable');
    expect(expire).toHaveBeenCalledWith({ tenantId: tenant.id, sessionId: 'cs-1', mode: 'live' });
    expect(h.stock.levels.get(tenant.id, poster.id)).toMatchObject({ onHand: 1, reserved: 0 });
  });

  it('returns sold_out with the product title before capturing a snapshot or calling Stripe', async () => {
    const h = checkoutHarness();
    h.stock.track(tenant.id, poster.id, 0);
    const selection = await validateCheckoutSelection(tenant.id, { productId: poster.id }, h.deps);
    expect(selection).toEqual({ ok: false, error: { code: 'sold_out', message: '"Printed poster" is sold out', details: { productId: poster.id } } });
    expect(await createCheckoutSession(tenant, 'https://alpha.example.com', { productId: poster.id }, h.deps)).toMatchObject({ ok: false, error: { code: 'sold_out' } });
    expect(h.snapshots.size).toBe(0);
    expect(h.createSession).not.toHaveBeenCalled();
  });

  it('lets the reservation UPDATE stay the authority when the cheap read raced', async () => {
    const h = checkoutHarness();
    h.stock.track(tenant.id, poster.id, 1);
    const selection = await validateCheckoutSelection(tenant.id, { productId: poster.id }, h.deps);
    if (!selection.ok) throw new Error('selection failed');
    await h.stock.repository.reserve(tenant.id, { checkoutSnapshotId: 'other-buyer', productIds: [poster.id], expiresAt: now, quantity: 1, now });
    const started = await startCheckoutSession(tenant, 'https://alpha.example.com', { productId: poster.id }, selection.value, h.deps);
    expect(started).toMatchObject({ ok: false, error: { code: 'sold_out', message: '"Printed poster" is sold out' } });
    expect(h.createSession).not.toHaveBeenCalled();
  });

  it('never reserves live stock for a staff test checkout', async () => {
    const h = checkoutHarness();
    h.stock.track(tenant.id, poster.id, 1);
    const selection = await validateCheckoutSelection(tenant.id, { productId: poster.id }, h.deps);
    if (!selection.ok) throw new Error('selection failed');
    const started = await startCheckoutSession(tenant, 'https://alpha.example.com', { productId: poster.id }, selection.value, h.deps, undefined, { mode: 'test', memberId: 'member-1' });
    expect(started.ok).toBe(true);
    expect(h.stock.reservations).toEqual([]);
    expect(h.createSession.mock.calls[0]?.[0]).not.toHaveProperty('expiresAt');
  });

  it('keeps the hold for a free checkout so the immediate fulfilment commits it', async () => {
    const free = { ...poster, priceCents: 0 };
    const h = checkoutHarness([free]);
    h.stock.track(tenant.id, free.id, 2);
    const started = await createCheckoutSession(tenant, 'https://alpha.example.com', { productId: free.id, email: 'buyer@example.com' }, h.deps);
    expect(started).toMatchObject({ ok: true, value: { free: true } });
    expect(h.createSession).not.toHaveBeenCalled();
    const snapshotId = started.ok ? started.value.checkoutSnapshotId ?? null : null;
    expect(h.stock.reservations).toEqual([expect.objectContaining({ checkoutSnapshotId: snapshotId, status: 'active' })]);
    const alerts = alertHarness();
    const effects = await commitCheckoutStock(tenant, { checkoutSnapshotId: snapshotId, orderId: 'order-free', productIds: [free.id] }, { ...alerts.deps, stock: h.stock.repository });
    expect(effects).toEqual({ alertsQueued: false });
    expect(h.stock.levels.get(tenant.id, free.id)).toMatchObject({ onHand: 1, reserved: 0 });
    expect(h.stock.events.map((event) => event.type)).toEqual(['reserved', 'committed']);
  });
});

describe('checkout stock commit', () => {
  it('is idempotent for webhook retries of the same snapshot', async () => {
    const h = alertHarness();
    h.stock.track(tenant.id, poster.id, 5);
    await h.stock.repository.reserve(tenant.id, { checkoutSnapshotId: 'snapshot-1', productIds: [poster.id], expiresAt: now, quantity: 1, now });
    await h.commit('order-1', 'snapshot-1');
    await h.commit('order-1', 'snapshot-1');
    expect(h.stock.levels.get(tenant.id, poster.id)).toMatchObject({ onHand: 4, reserved: 0 });
    expect(h.stock.events.filter((event) => event.type === 'committed')).toHaveLength(1);
  });

  it('still decrements on hand when the paid webhook arrives after the reservation expired', async () => {
    const h = alertHarness();
    h.stock.track(tenant.id, poster.id, 5);
    await h.stock.repository.reserve(tenant.id, { checkoutSnapshotId: 'snapshot-late', productIds: [poster.id], expiresAt: now, quantity: 1, now });
    expect((await releaseExpiredStockReservations({ stock: h.stock.repository, clock: { nowIso: () => '2026-11-05T11:00:00.000Z' }, logger: h.deps.logger })).ok).toBe(true);
    await h.commit('order-late', 'snapshot-late');
    expect(h.stock.levels.get(tenant.id, poster.id)).toMatchObject({ onHand: 4, reserved: 0 });
    expect(h.stock.events.map((event) => event.type)).toEqual(['reserved', 'released', 'committed_late']);
  });

  it('clamps an oversold commit, logs a warning and alerts staff with the oversold flag', async () => {
    const h = alertHarness();
    h.stock.track(tenant.id, poster.id, 0);
    expect(await h.commit('order-oversold', 'snapshot-oversold')).toEqual({ alertsQueued: true });
    expect(h.stock.levels.get(tenant.id, poster.id)).toMatchObject({ onHand: 0 });
    expect(h.warnings).toEqual([expect.stringContaining('[stock] oversold tenant=tenant-a product=poster order=order-oversold')]);
    expect(h.queued).toEqual([{ to: 'owner@example.com', payload: expect.objectContaining({ kind: 'stock-low', oversold: true, available: 0, productTitle: 'Printed poster', studioUrl: 'https://alpha.together.example.com/panel/products/poster' }) }]);
  });

  it('alerts once when availability crosses the threshold, again at zero, and again after a restock resets it', async () => {
    const h = alertHarness();
    h.stock.track(tenant.id, poster.id, 3, 2);
    await h.commit('order-1', 'snapshot-1');
    expect(h.queued).toHaveLength(1);
    expect(h.queued[0]?.payload).toMatchObject({ kind: 'stock-low', available: 2, threshold: 2, oversold: false });
    expect(h.stock.levels.get(tenant.id, poster.id)?.lowStockNotifiedAt).toBe(now);
    await h.commit('order-2', 'snapshot-2');
    expect(h.queued).toHaveLength(1);
    await h.commit('order-3', 'snapshot-3');
    expect(h.queued).toHaveLength(2);
    expect(h.queued[1]?.payload).toMatchObject({ available: 0, oversold: false });
    const restocked = await adjustProductStock(staffCtx(), { productId: poster.id, delta: 5, reason: 'delivery' }, { products: productRepository([poster]), stock: h.stock.repository, clock: { nowIso: () => now } });
    expect(restocked).toMatchObject({ ok: true, value: { onHand: 5, available: 5, lowStockNotifiedAt: null } });
    await h.commit('order-4', 'snapshot-4');
    await h.commit('order-5', 'snapshot-5');
    expect(h.queued).toHaveLength(2);
    await h.commit('order-6', 'snapshot-6');
    expect(h.queued).toHaveLength(3);
  });

  it.each(['one buyer after another', 'three open checkouts'] as const)('sends one threshold alert and one zero alert for the last three pieces sold by %s', async (flow) => {
    const h = alertHarness();
    h.stock.track(tenant.id, poster.id, 3, 2);
    const snapshots = ['snapshot-1', 'snapshot-2', 'snapshot-3'];
    const reserve = (checkoutSnapshotId: string) => h.stock.repository.reserve(tenant.id, { checkoutSnapshotId, productIds: [poster.id], expiresAt: '2026-11-05T10:36:00.000Z', quantity: 1, now });
    if (flow === 'three open checkouts') for (const snapshot of snapshots) await reserve(snapshot);
    for (const [index, snapshot] of snapshots.entries()) {
      if (flow === 'one buyer after another') await reserve(snapshot);
      await h.commit(`order-${String(index + 1)}`, snapshot);
    }
    expect(h.stock.levels.get(tenant.id, poster.id)).toMatchObject({ onHand: 0, reserved: 0 });
    expect(h.queued.map((message) => message.payload)).toEqual([
      expect.objectContaining({ kind: 'stock-low', available: flow === 'three open checkouts' ? 0 : 2, threshold: 2, oversold: false }),
      expect.objectContaining({ kind: 'stock-low', available: 0, threshold: 2, oversold: false }),
    ]);
  });

  it('sends the zero alert once when a late commit takes the last free piece while two checkouts hold the rest', async () => {
    const h = alertHarness();
    h.stock.track(tenant.id, poster.id, 4, 3);
    const later = '2026-11-05T10:36:00.000Z';
    const reserve = (checkoutSnapshotId: string, expiresAt: string) => h.stock.repository.reserve(tenant.id, { checkoutSnapshotId, productIds: [poster.id], expiresAt, quantity: 1, now });
    await h.commit('order-1', 'snapshot-1');
    expect(h.queued.map((message) => message.payload)).toEqual([expect.objectContaining({ available: 3, threshold: 3, oversold: false })]);
    await reserve('snapshot-held-1', later);
    await reserve('snapshot-held-2', later);
    await reserve('snapshot-late', now);
    await h.stock.repository.releaseExpired('2026-11-05T10:01:00.000Z', 10);
    await h.commit('order-late', 'snapshot-late');
    expect(h.stock.levels.get(tenant.id, poster.id)).toMatchObject({ onHand: 2, reserved: 2, soldOutNotifiedAt: now });
    expect(h.queued.map((message) => message.payload)).toEqual([
      expect.objectContaining({ available: 3, threshold: 3, oversold: false }),
      expect.objectContaining({ available: 0, threshold: 3, oversold: false }),
    ]);
    await h.commit('order-held-1', 'snapshot-held-1');
    await h.commit('order-held-2', 'snapshot-held-2');
    expect(h.stock.levels.get(tenant.id, poster.id)).toMatchObject({ onHand: 0, reserved: 0 });
    expect(h.queued).toHaveLength(2);
    const restocked = await adjustProductStock(staffCtx(), { productId: poster.id, delta: 1, reason: 'delivery' }, { products: productRepository([poster]), stock: h.stock.repository, clock: { nowIso: () => now } });
    expect(restocked.ok).toBe(true);
    expect(h.stock.levels.get(tenant.id, poster.id)).toMatchObject({ onHand: 1, soldOutNotifiedAt: null });
    await h.commit('order-restocked', 'snapshot-restocked');
    expect(h.queued).toHaveLength(3);
    expect(h.queued[2]?.payload).toMatchObject({ available: 0, oversold: false });
  });

  it('marks the alert sent when at least one recipient was queued even if another enqueue failed', async () => {
    const h = alertHarness();
    h.deps.tenantAccess = { listStaffForTenant: async () => [
      { userId: 'owner', email: 'owner@example.com', staffRole: 'owner', language: 'en' },
      { userId: 'admin', email: 'admin@example.com', staffRole: 'admin', language: 'en' },
    ] };
    const enqueue = h.deps.emailOutbox.enqueue;
    h.deps.emailOutbox = { enqueue: async (message) => message.to === 'owner@example.com' ? err(internal('Outbox unavailable')) : enqueue(message) };
    h.stock.track(tenant.id, poster.id, 2, 1);
    expect(await h.commit('order-1')).toEqual({ alertsQueued: true });
    expect(h.queued.map((message) => message.to)).toEqual(['admin@example.com']);
    expect(h.stock.levels.get(tenant.id, poster.id)).toMatchObject({ onHand: 1, lowStockNotifiedAt: now });
    expect(h.warnings).toEqual([expect.stringContaining('[stock] low-stock alert not queued tenant=tenant-a product=poster: Outbox unavailable')]);
  });

  it('keeps the alert pending when the workspace has no recipient for it', async () => {
    const h = alertHarness();
    h.deps.tenantAccess = { listStaffForTenant: async () => [] };
    h.stock.track(tenant.id, poster.id, 2, 1);
    expect(await h.commit('order-1', 'snapshot-1')).toEqual({ alertsQueued: false });
    expect(h.queued).toEqual([]);
    expect(h.stock.levels.get(tenant.id, poster.id)).toMatchObject({ onHand: 1, lowStockNotifiedAt: null });
  });

  it('skips untracked products entirely', async () => {
    const h = alertHarness();
    expect(await h.commit('order-untracked', 'snapshot-untracked')).toEqual({ alertsQueued: false });
    expect(h.stock.events).toEqual([]);
  });
});

describe('expired reservation sweep', () => {
  it('releases only expired reservations and logs one line when it released any', async () => {
    const stock = createStockRepositoryFake();
    stock.track(tenant.id, poster.id, 5);
    await stock.repository.reserve(tenant.id, { checkoutSnapshotId: 'expired', productIds: [poster.id], expiresAt: '2026-11-05T09:59:00.000Z', quantity: 1, now });
    await stock.repository.reserve(tenant.id, { checkoutSnapshotId: 'current', productIds: [poster.id], expiresAt: '2026-11-05T10:30:00.000Z', quantity: 1, now });
    const warnings: string[] = [];
    const deps = { stock: stock.repository, clock: { nowIso: () => now }, logger: { warn: (message: string) => { warnings.push(message); } } };
    expect(await releaseExpiredStockReservations(deps)).toEqual({ ok: true, value: { released: 1 } });
    expect(await releaseExpiredStockReservations(deps)).toEqual({ ok: true, value: { released: 0 } });
    expect(warnings).toEqual(['[stock] released 1 expired checkout reservation(s)']);
    expect(stock.reservations.map((reservation) => [reservation.checkoutSnapshotId, reservation.status])).toEqual([['expired', 'released'], ['current', 'active']]);
  });
});

describe('Studio stock management', () => {
  const deps = () => {
    const stock = createStockRepositoryFake();
    return { stock, deps: { products: productRepository([poster]), stock: stock.repository, clock: { nowIso: () => now } } };
  };

  it('enables tracking, adjusts with a reason and sets the threshold for staff', async () => {
    const h = deps();
    expect(await getProductStock(staffCtx(), poster.id, h.deps)).toEqual({ ok: true, value: null });
    expect(await enableProductStock(staffCtx(), { productId: poster.id, onHand: 2 }, h.deps)).toMatchObject({ ok: true, value: { onHand: 2, reserved: 0, available: 2, lowStockThreshold: null } });
    expect(await enableProductStock(staffCtx(), { productId: poster.id, onHand: 2 }, h.deps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await adjustProductStock(staffCtx(), { productId: poster.id, delta: -2, reason: 'damaged' }, h.deps)).toMatchObject({ ok: true, value: { onHand: 0, soldOut: true } });
    expect(await adjustProductStock(staffCtx(), { productId: poster.id, delta: -1, reason: 'damaged' }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await adjustProductStock(staffCtx(), { productId: poster.id, delta: 1, reason: 'returned' }, h.deps)).toMatchObject({ ok: true, value: { onHand: 1 } });
    expect(await setProductStockThreshold(staffCtx(), { productId: poster.id, lowStockThreshold: 1 }, h.deps)).toMatchObject({ ok: true, value: { lowStockThreshold: 1, low: true } });
    expect(h.stock.events.map((event) => event.type)).toEqual(['tracking_enabled', 'adjusted', 'returned']);
  });

  it('refuses members, unknown products and invalid payloads', async () => {
    const h = deps();
    expect(await enableProductStock(staffCtx(null), { productId: poster.id, onHand: 2 }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await getProductStock(staffCtx(null), poster.id, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await enableProductStock(staffCtx(), { productId: 'missing', onHand: 2 }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await adjustProductStock(staffCtx(), { productId: poster.id, delta: 0, reason: 'count' }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await adjustProductStock(staffCtx(), { productId: poster.id, delta: 1, reason: 'count' }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('refuses counts above the stock cap', async () => {
    const h = deps();
    expect(await enableProductStock(staffCtx(), { productId: poster.id, onHand: 1_000_001 }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await enableProductStock(staffCtx(), { productId: poster.id, onHand: 1_000_000 }, h.deps)).toMatchObject({ ok: true });
    expect(await adjustProductStock(staffCtx(), { productId: poster.id, delta: 1, reason: 'count' }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.stock.levels.get(tenant.id, poster.id)).toMatchObject({ onHand: 1_000_000 });
  });
});
