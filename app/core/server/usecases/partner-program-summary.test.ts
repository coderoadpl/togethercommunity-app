import { expect, it, vi } from 'vitest';
import { commissionSchema, ok, orderListItemSchema, partnerProgramSchema, type Identity } from '#core/domain/index.js';
import type { PartnerManagementDeps } from './partner-management.js';
import { listPartnerPrograms } from './partner-management.js';

it('keeps commission totals separate by order currency and status', async () => {
  const now = '2026-10-13T12:00:00.000Z';
  const program = partnerProgramSchema.parse({ id: 'program', tenantId: 'tenant', name: 'Ambassadors', commissionPct: 50, createdAt: now, revision: 1 });
  const identity: Identity = { userId: 'owner', email: 'owner@example.org', name: 'Owner', emailVerified: true, tenantAccess: 'staff', tenantId: 'tenant', tenantSlug: 'acme', tenantName: 'Workspace', staffRole: 'owner', memberId: null, image: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false };
  const commissions = [
    { orderId: 'eur', amountCents: 100, status: 'pending' },
    { orderId: 'eur', amountCents: 250, status: 'pending' },
    { orderId: 'usd', amountCents: 400, status: 'pending' },
    { orderId: 'usd', amountCents: 600, status: 'payable' },
    { orderId: 'eur', amountCents: 800, status: 'paid' },
    { orderId: 'eur', amountCents: 900, status: 'voided' },
  ].map((entry, index) => commissionSchema.parse({ id: `commission-${index}`, tenantId: 'tenant', orderLineId: `line-${index}`, programId: program.id, partnerId: 'partner', partnerCodeId: 'code', baseCents: 1000, pct: 40, payableAt: now, voidedReason: null, payoutId: null, createdAt: now, ...entry }));
  const findById = vi.fn(async (_tenantId: string, id: string) => orderListItemSchema.parse({ id, tenantId: 'tenant', memberId: 'member', productId: 'product', priceId: null, kind: 'one_time', status: 'paid', amountCents: 1000, currency: id === 'eur' ? 'EUR' : 'USD', provider: 'stripe', providerObjectIds: {}, couponId: null, discountCents: 0, createdAt: now, memberEmail: 'member@example.org', memberName: null, productTitle: 'Course', couponCode: null }));
  const deps: PartnerManagementDeps = {
    partners: {
      listPrograms: async () => [program], findProgram: async () => null, saveProgram: async (_tenantId, value) => ok(value),
      listPartners: async () => [], findPartner: async () => null, savePartner: async (_tenantId, value) => ok(value),
      listCodes: async () => [], findCode: async () => null, findCodeByCode: async () => null, saveCode: async (_tenantId, value) => ok(value),
      reserveCheckout: async () => ok(undefined), attachCheckoutSession: async () => undefined, releaseCheckout: async () => false, completeCheckout: async () => ok(undefined),
      cacheStripeIds: async () => null, listCheckoutReservations: async () => [], countRedemptions: async () => 0, hasActiveCodeForSalesLink: async () => false,
      listCommissions: async () => commissions, createCommissions: async () => undefined, voidPendingCommissions: async () => undefined,
    },
    orders: { findById },
    coupons: { findByCode: async () => null }, members: { findByEmail: async () => null, findById: async () => null }, salesLinks: { findById: async () => null },
    payments: {}, ids: { nextId: () => 'id' }, clock: { nowIso: () => now },
  };
  expect(await listPartnerPrograms({ identity }, deps)).toMatchObject({ ok: true, value: { programs: [{ currencyTotals: [
    { currency: 'EUR', pendingCents: 350, payableCents: 0, paidCents: 800 },
    { currency: 'USD', pendingCents: 400, payableCents: 600, paidCents: 0 },
  ] }] } });
  expect(findById).toHaveBeenCalledTimes(2);
  expect(findById).toHaveBeenCalledWith('tenant', 'eur');
  expect(findById).toHaveBeenCalledWith('tenant', 'usd');
});
