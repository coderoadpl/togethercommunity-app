import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { API_PATHS, staffRefundContracts } from '#core/contract/index.js';
import {
  ok,
  orderListItemSchema,
  PLATFORM_COMMITTED_REFUND_STATUSES,
  STAFF_REFUND_WAITING_STATUSES,
  type Identity,
  type ImpersonationPrincipal,
  type OrderListItem,
  type OrderStaffRefund,
  type Tenant,
} from '#core/domain/index.js';
import type { OrderStaffRefundRepository, PublicRateLimitRepository } from '#core/server/index.js';
import { createInMemoryTenantDomainRepository } from '#core/server/testing/tenant-domain-fakes.js';

import type { AppVars } from './app-vars.js';
import { requestOriginGuard } from './request-origin.js';
import { registerStaffRefundRoutes, STAFF_REFUND_RATE_LIMITS, type StaffRefundRateLimits } from './staff-refund-routes.js';

const identity = (overrides: Partial<Identity> = {}): Identity => ({
  userId: 'owner-1', email: 'owner@acme.example.com', name: 'Owner', emailVerified: true, image: null, tenantAccess: 'staff',
  tenantId: 'acme', tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner', memberId: null, memberDisplayName: null,
  memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false, ...overrides,
});

const admin = identity({ userId: 'admin-1', email: 'admin@acme.example.com', staffRole: 'admin' });
const member = identity({ userId: 'member-1', staffRole: null, tenantAccess: 'member', memberId: 'member-1' });
const otherWorkspaceOwner = identity({ userId: 'owner-2', tenantId: 'studio', tenantSlug: 'studio', tenantName: 'Studio' });

const impersonation: ImpersonationPrincipal = {
  id: 'view-1', actorUserId: 'owner-1', actorEmail: 'owner@acme.example.com', actorName: 'Owner', actorStaffRole: 'owner',
  subjectMemberId: 'member-1', subjectName: 'Buyer', expiresAt: '2026-11-22T11:00:00.000Z',
};

const paidOrder = (): OrderListItem => orderListItemSchema.parse({
  id: 'order-1', tenantId: 'acme', memberId: 'member-1', productId: 'book', priceId: null, kind: 'one_time', status: 'paid', mode: 'live',
  amountCents: 4099, currency: 'PLN', provider: 'stripe', providerObjectIds: { checkoutSession: 'cs_1', paymentIntent: 'pi_1' }, couponId: null,
  discountCents: 0, createdAt: '2026-11-20T09:00:00.000Z', paidAt: '2026-11-20T09:01:00.000Z', memberEmail: 'buyer@example.org',
  memberName: 'Buyer', productTitle: 'Printed book', couponCode: null, fulfilmentStatus: 'to_pack',
  shipping: {
    rateId: 'courier', label: 'Courier', amountCents: 1999, vatRatePercent: 8, carrier: 'other', pickupPoint: null,
    address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' }, phone: null,
  },
});

const isIn = (statuses: readonly string[], status: string): boolean => statuses.includes(status);

const staffRefundsFake = (order: OrderListItem) => {
  const refunds: OrderStaffRefund[] = [];
  const committed = () => refunds.filter((refund) => isIn(PLATFORM_COMMITTED_REFUND_STATUSES, refund.status)).reduce((sum, refund) => sum + refund.amountCents, 0);
  const owns = (tenantId: string, orderId: string) => tenantId === order.tenantId && orderId === order.id;
  const repository: OrderStaffRefundRepository = {
    create: async (tenantId, input) => {
      if (!owns(tenantId, input.orderId)) throw new Error('order of another workspace reached the repository');
      const decision = input.decide({
        order,
        platformCommittedCents: committed(),
        sameRequest: refunds.find((refund) => refund.requestKey === input.requestKey) ?? null,
        waiting: refunds.find((refund) => isIn(STAFF_REFUND_WAITING_STATUSES, refund.status)) ?? null,
        hasLabel: false,
      });
      if (!decision.ok) return decision;
      if (decision.value.kind === 'existing') return ok({ refund: decision.value.refund, created: false, returnedToStock: [] });
      refunds.push(decision.value.refund);
      if (decision.value.refund.removedFromPackingList) order.fulfilmentStatus = null;
      return ok({ refund: decision.value.refund, created: true, returnedToStock: [] });
    },
    listByOrder: async (tenantId, orderId) => (owns(tenantId, orderId) ? refunds.toReversed() : []),
    platformCommittedCents: async (tenantId, orderId) => (owns(tenantId, orderId) ? committed() : 0),
    hasLabel: async () => false,
    returnableStock: async (tenantId, orderId) => (owns(tenantId, orderId) ? [{ productId: 'book', quantity: 1 }] : []),
    committedCentsByOrder: async () => new Map(),
    activeStatusByOrder: async () => new Map(),
    noteChargeRefunded: async () => [],
    shipAnyway: async () => {
      order.fulfilmentStatus = 'to_pack';
      return ok(order);
    },
  };
  return { repository, refunds };
};

const rateLimitBucketsFake = (): PublicRateLimitRepository => {
  const counts = new Map<string, number>();
  return {
    claim: async (input) => {
      const key = `${input.scope}|${input.key}|${input.windowStartedAt}`;
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next <= input.limit;
    },
    purgeExpired: async () => 0,
  };
};

const workspace: Tenant = { id: 'acme', slug: 'acme', name: 'Acme', status: 'active', plan: 'hosted', contentVersion: 1 };

const originGuard = () => requestOriginGuard({
  appBaseUrl: 'https://app.together.test',
  deploymentAuthOrigins: [],
  baseDomain: 'together.test',
  platformHost: null,
  singleTenantMode: false,
  tenants: {
    findById: async (id) => (id === workspace.id ? workspace : null),
    findBySlug: async (slug) => (slug === workspace.slug ? workspace : null),
    findSole: async () => workspace,
    findSettings: async () => null,
    changeSettings: async () => null,
    createTenantWithOwnerGrant: async () => null,
    hasAny: async () => true,
  },
  tenantDomains: createInMemoryTenantDomainRepository(),
  authPort: { getAuthenticatedUser: async (headers) => (headers.get('cookie')?.includes('session=valid') === true ? { sessionId: 'session', userId: 'owner-1', email: 'owner@acme.example.com', name: 'Owner', emailVerified: true, image: null } : null) },
});

const harness = (options: { viewer?: Identity; impersonating?: boolean; guarded?: boolean; limits?: StaffRefundRateLimits } = {}) => {
  const order = paidOrder();
  const staffRefunds = staffRefundsFake(order);
  const listRefunds = vi.fn(async () => ok([]));
  const dispatchOrderRefunds = vi.fn();
  const logs: string[] = [];
  let viewer = options.viewer ?? identity();
  let sequence = 0;
  const app = new Hono<AppVars>();
  if (options.guarded === true) app.use('/api/*', originGuard());
  app.use('*', async (c, next) => {
    c.set('identity', viewer);
    if (options.impersonating === true) c.set('impersonation', impersonation);
    await next();
  });
  registerStaffRefundRoutes(app, {
    orderDetails: { findById: async (tenantId, id) => (tenantId === order.tenantId && id === order.id ? order : null) },
    orderStaffRefunds: staffRefunds.repository,
    payment: { listRefunds },
    ids: { nextId: () => { sequence += 1; return `refund-${String(sequence)}`; } },
    clock: { nowIso: () => '2026-11-22T10:00:00.000Z' },
    logger: { warn: (message) => { logs.push(message); }, error: (message) => { logs.push(message); } },
    dispatchOrderRefunds,
    rateLimitBuckets: rateLimitBucketsFake(),
  }, options.limits);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => app.request(`https://acme.together.test${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const preview = (headers: Record<string, string> = {}) => app.request(`https://acme.together.test${API_PATHS.orderRefundPreview.replace(':orderId', 'order-1')}`, { headers });
  const refund = (body: unknown, headers: Record<string, string> = {}) => post(API_PATHS.orderRefundCreate.replace(':orderId', 'order-1'), body, headers);
  const shipAnyway = (headers: Record<string, string> = {}) => post(API_PATHS.orderShipAnyway.replace(':orderId', 'order-1'), {}, headers);
  const actAs = (next: Identity) => { viewer = next; };
  return { app, order, refunds: staffRefunds.refunds, listRefunds, dispatchOrderRefunds, logs, preview, refund, shipAnyway, actAs };
};

const envelope = <S extends z.ZodTypeAny>(data: S) => z.object({ ok: z.literal(true), data });
const failure = z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) });

describe('staff refund HTTP routes', () => {
  it('lets an owner preview and refund the whole remainder once, and kicks the refund dispatcher after the request commits', async () => {
    const h = harness();
    const previewed = await h.preview();
    expect(previewed.status).toBe(200);
    expect(envelope(staffRefundContracts.orderRefundPreview.output).parse(await previewed.json()).data).toMatchObject({
      orderId: 'order-1', refundable: true, paidCents: 4099, refundedCents: 0, remainderCents: 4099, currency: 'PLN', mode: 'live',
      remainderSource: 'provider', returnableStock: [{ productId: 'book', quantity: 1 }], onPackingList: true, hasShipment: false,
      fullRefundOptions: { restockDefault: true, removeFromPackingListDefault: true }, waitingRefundId: null,
    });
    expect(h.listRefunds).toHaveBeenCalledWith({ mode: 'live', tenantId: 'acme', paymentIntentId: 'pi_1' });

    const created = await h.refund({ requestKey: 'studio-click-1', reason: 'Damaged in transit' });
    expect(created.status).toBe(200);
    const first = envelope(staffRefundContracts.orderRefundCreate.output).parse(await created.json()).data;
    expect(first).toMatchObject({ created: true, refund: { kind: 'remainder', amountCents: 4099, status: 'pending', restocked: true, removedFromPackingList: true, note: 'Damaged in transit', requestedByUserId: 'owner-1' } });
    expect(h.dispatchOrderRefunds).toHaveBeenCalledTimes(1);
    expect(h.logs).toEqual([expect.stringContaining('staff refund requested tenant=acme order=order-1 refund=refund-1 actor=owner-1 amount=4099')]);
    expect(h.logs[0]).not.toContain('owner@acme.example.com');

    const repeated = await h.refund({ requestKey: 'studio-click-1' });
    expect(repeated.status).toBe(200);
    expect(envelope(staffRefundContracts.orderRefundCreate.output).parse(await repeated.json()).data).toMatchObject({ created: false, refund: { id: first.refund.id } });
    expect(h.refunds).toHaveLength(1);
    expect(h.dispatchOrderRefunds).toHaveBeenCalledTimes(1);
  });

  it('lets an admin refund part of the order and refuses a second refund while the first waits for the provider', async () => {
    const h = harness({ viewer: admin });
    const partial = await h.refund({ requestKey: 'partial-1', amountCents: 1000 });
    expect(partial.status).toBe(200);
    expect(envelope(staffRefundContracts.orderRefundCreate.output).parse(await partial.json()).data.refund).toMatchObject({ kind: 'amount', amountCents: 1000, restocked: false, removedFromPackingList: false, requestedByUserId: 'admin-1' });
    const second = await h.refund({ requestKey: 'partial-2', amountCents: 500 });
    expect(second.status).toBe(409);
    expect(failure.parse(await second.json()).error.code).toBe('conflict');
    expect(h.refunds).toHaveLength(1);
  });

  it('refuses an amount above the remainder, an unknown field and a body that is not JSON without writing', async () => {
    const h = harness();
    const above = await h.refund({ requestKey: 'too-much', amountCents: 4100 });
    expect(above.status).toBe(400);
    expect(failure.parse(await above.json()).error.message).toContain('40.99 PLN');
    expect((await h.refund({ requestKey: 'extra', orderId: 'order-2' })).status).toBe(400);
    const notJson = await h.app.request(`https://acme.together.test${API_PATHS.orderRefundCreate.replace(':orderId', 'order-1')}`, { method: 'POST', body: 'requestKey=x' });
    expect(notJson.status).toBe(400);
    expect(h.refunds).toEqual([]);
    expect(h.dispatchOrderRefunds).not.toHaveBeenCalled();
  });

  it('puts an order a full refund took off the packing list back with ship anyway', async () => {
    const h = harness();
    expect((await h.refund({ requestKey: 'full-1' })).status).toBe(200);
    expect(h.order.fulfilmentStatus).toBeNull();
    const shipped = await h.shipAnyway();
    expect(shipped.status).toBe(200);
    expect(envelope(staffRefundContracts.orderShipAnyway.output).parse(await shipped.json()).data.order).toMatchObject({ id: 'order-1', fulfilmentStatus: 'to_pack' });
  });

  it('forbids a member every refund route and writes nothing', async () => {
    const h = harness({ viewer: member });
    for (const response of [await h.preview(), await h.refund({ requestKey: 'member-1' }), await h.shipAnyway()]) {
      expect(response.status).toBe(403);
      expect(failure.parse(await response.json()).error).toEqual({ code: 'forbidden', message: 'order:refund is not permitted' });
    }
    expect(h.refunds).toEqual([]);
    expect(h.listRefunds).not.toHaveBeenCalled();
  });

  it('forbids a staff account whose e-mail is not verified', async () => {
    const h = harness({ viewer: identity({ emailVerified: false }) });
    const response = await h.refund({ requestKey: 'unverified-1' });
    expect(response.status).toBe(403);
    expect(failure.parse(await response.json()).error.message).toBe('order:refund requires a verified email address');
    expect(h.refunds).toEqual([]);
  });

  it('answers not found to the owner of another workspace', async () => {
    const h = harness({ viewer: otherWorkspaceOwner });
    for (const response of [await h.preview(), await h.refund({ requestKey: 'other-1' }), await h.shipAnyway()]) {
      expect(response.status).toBe(404);
      expect(failure.parse(await response.json()).error.code).toBe('not_found');
    }
    expect(h.refunds).toEqual([]);
    expect(h.listRefunds).not.toHaveBeenCalled();
  });

  it('refuses every refund route, the preview included, while staff view the workspace as a member', async () => {
    const h = harness({ impersonating: true });
    for (const response of [await h.preview(), await h.refund({ requestKey: 'view-1' }), await h.shipAnyway()]) {
      expect(response.status).toBe(403);
      expect(failure.parse(await response.json()).error.code).toBe('impersonation_read_only');
    }
    expect(h.refunds).toEqual([]);
    expect(h.listRefunds).not.toHaveBeenCalled();
  });

  it('refuses a cookie POST without origin metadata or from another site before the refund is created', async () => {
    const h = harness({ guarded: true });
    for (const headers of [{ cookie: 'session=valid' }, { cookie: 'session=valid', origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' }]) {
      for (const response of [await h.refund({ requestKey: 'csrf-1' }, headers), await h.shipAnyway(headers)]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ ok: false, error: { code: 'forbidden', message: 'Request origin is not allowed' } });
      }
    }
    expect(h.refunds).toEqual([]);
    const sameOrigin = await h.refund({ requestKey: 'csrf-1' }, { cookie: 'session=valid', origin: 'https://acme.together.test', 'sec-fetch-site': 'same-origin' });
    expect(sameOrigin.status).toBe(200);
  });

  it('limits refund requests per staff member and per workspace with Retry-After', async () => {
    const limits: StaffRefundRateLimits = {
      ...STAFF_REFUND_RATE_LIMITS,
      write: { perActor: { limit: 2, windowMs: 60_000 }, perWorkspace: { limit: 3, windowMs: 60_000 } },
    };
    const h = harness({ limits });
    expect((await h.refund({ requestKey: 'rate-1' })).status).toBe(200);
    expect((await h.refund({ requestKey: 'rate-1' })).status).toBe(200);
    const limited = await h.refund({ requestKey: 'rate-1' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(failure.parse(await limited.json()).error.code).toBe('rate_limited');
    h.actAs(admin);
    expect((await h.shipAnyway()).status).toBe(200);
    const workspaceLimited = await h.shipAnyway();
    expect(workspaceLimited.status).toBe(429);
    expect(h.refunds).toHaveLength(1);
  });
});
