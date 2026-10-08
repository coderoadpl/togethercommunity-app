import { describe, expect, it, vi } from 'vitest';
import { err, notFound, ok, orderListItemSchema, type Capability, type Identity } from '#core/domain/index.js';
import { issueOrderLine, verifyOrder, type OrderVerificationDeps } from './order-verification.js';

const identity: Identity = {
  userId: 'staff', email: 'staff@example.org', name: 'Staff', emailVerified: true,
  image: null, tenantAccess: 'staff', tenantId: 'workspace', tenantSlug: 'workspace', tenantName: 'Workspace', staffRole: 'owner',
  memberId: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
};
const order = orderListItemSchema.parse({ id: 'order-number', tenantId: 'workspace', memberId: 'member', productId: 'physical', priceId: null, kind: 'one_time', status: 'paid', amountCents: 10500, currency: 'PLN', provider: 'simulated', providerObjectIds: {}, couponId: null, discountCents: 0, createdAt: '2026-10-08T12:00:00.000Z', memberEmail: 'buyer@example.org', memberName: 'Buyer', productTitle: 'Printed material', couponCode: null, verificationToken: 'b'.repeat(64) });
const harness = () => {
  const findByReference = vi.fn(async () => order);
  const issueLine = vi.fn(async () => ok(order));
  const deps: OrderVerificationDeps = { orderVerification: { findByToken: async () => order, findByReference, issueLine }, clock: { nowIso: () => '2026-10-08T13:00:00.000Z' } };
  return { deps, findByReference, issueLine };
};
const ctx = (capabilities: Capability[]) => ({ identity, capabilities });

describe('order verification capabilities', () => {
  it('looks up a token or order number only in the authenticated workspace', async () => {
    const h = harness();
    for (const reference of [order.verificationToken ?? '', order.id]) {
      expect(await verifyOrder(ctx(['order:read']), ` ${reference} `, h.deps)).toEqual(ok({ order }));
      expect(h.findByReference).toHaveBeenLastCalledWith('workspace', reference);
    }
  });
  it('returns not found for unknown or empty references', async () => {
    const h = harness();
    h.deps.orderVerification.findByReference = async () => null;
    expect(await verifyOrder(ctx(['order:read']), 'unknown', h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await verifyOrder(ctx(['order:read']), ' ', h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
  it('separates read from write and denies members without reaching storage', async () => {
    const h = harness();
    expect(await verifyOrder(ctx(['order:write']), 'reference', h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await verifyOrder({ identity: { ...identity, staffRole: null, tenantAccess: 'member', memberId: 'member' } }, 'reference', h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await issueOrderLine(ctx(['order:read']), { orderId: order.id, productId: 'physical' }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.findByReference).not.toHaveBeenCalled();
    expect(h.issueLine).not.toHaveBeenCalled();
  });
  it('records the authenticated staff identity and clock value', async () => {
    const h = harness();
    expect(await issueOrderLine(ctx(['order:write']), { orderId: order.id, productId: 'physical' }, h.deps)).toEqual(ok({ order }));
    expect(h.issueLine).toHaveBeenCalledWith('workspace', { orderId: order.id, productId: 'physical', staffUserId: 'staff', occurredAt: '2026-10-08T13:00:00.000Z' });
  });
  it('propagates missing lines and rejects malformed issuance', async () => {
    const h = harness();
    h.deps.orderVerification.issueLine = async () => err(notFound('Order line was not found'));
    expect(await issueOrderLine(ctx(['order:write']), { orderId: order.id, productId: 'unknown' }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await issueOrderLine(ctx(['order:write']), { orderId: '', productId: 'physical' }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
