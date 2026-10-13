import { describe, expect, it, vi } from 'vitest';
import { orderSchema, partnerCodeSchema, partnerProgramSchema } from '#core/domain/index.js';
import { recordOrderCommissions } from './partner-ledger.js';

const now = '2026-10-13T12:00:00.000Z';
const program = partnerProgramSchema.parse({ id: 'program', tenantId: 'tenant', name: 'Ambassadors', commissionPct: 50, graceDays: 14, createdAt: now, revision: 1 });
const code = partnerCodeSchema.parse({ id: 'code', tenantId: 'tenant', programId: program.id, partnerId: 'partner', code: 'SAVE10', discountPct: 10, salesLinkIds: ['offer'], stripeCouponId: null, stripePromotionCodeId: null, createdAt: now, revision: 1 });
const order = orderSchema.parse({ id: 'order', tenantId: 'tenant', memberId: 'buyer', productId: 'course', priceId: null, kind: 'one_time', status: 'paid', amountCents: 12600, currency: 'EUR', provider: 'stripe', providerObjectIds: {}, couponId: null, partnerCodeId: code.id, discountCents: 1400, createdAt: now, lines: [
  { productId: 'course', name: 'Course', productType: 'course', grossCents: 12300, netCents: 10000, vatRate: 23, vatCents: 2300, vatExemptionBasis: null, issuedCount: null },
  { productId: 'download', name: 'Download', productType: 'digital_download', grossCents: 1000, netCents: 813, vatRate: 23, vatCents: 187, vatExemptionBasis: null, issuedCount: null },
  { productId: 'print', name: 'Print', productType: 'physical', grossCents: 700, netCents: 667, vatRate: 5, vatCents: 33, vatExemptionBasis: null, issuedCount: 0 },
] });

const harness = () => ({
  findCode: vi.fn(async () => code),
  findProgram: vi.fn(async () => program),
  createCommissions: vi.fn(async () => undefined),
});

describe('recordOrderCommissions', () => {
  it('uses immutable net lines before discount and excludes physical products', async () => {
    const partners = harness();
    let next = 0;
    await recordOrderCommissions(order, partners, { nextId: () => `commission-${++next}` });
    expect(partners.createCommissions).toHaveBeenCalledWith('tenant', [
      expect.objectContaining({ orderId: 'order', orderLineId: 'order:course', baseCents: 10000, pct: 40, amountCents: 4000, payableAt: '2026-10-27T12:00:00.000Z', status: 'pending' }),
      expect.objectContaining({ orderLineId: 'order:download', baseCents: 813, pct: 40, amountCents: 325 }),
    ]);
  });

  it.each([
    { mode: 'test' as const }, { status: 'pending' as const }, { partnerCodeId: null },
  ])('does not create commissions for an ineligible order: %j', async (change) => {
    const partners = harness();
    await recordOrderCommissions({ ...order, ...change }, partners, { nextId: () => 'unused' });
    expect(partners.findCode).not.toHaveBeenCalled();
    expect(partners.createCommissions).not.toHaveBeenCalled();
  });

  it('keeps attribution-only codes and zero earned commissions', async () => {
    for (const discountPct of [0, 50]) {
      const partners = { ...harness(), findCode: async () => ({ ...code, discountPct }) };
      await recordOrderCommissions(order, partners, { nextId: () => 'commission' });
      expect(partners.createCommissions).toHaveBeenCalledWith('tenant', expect.arrayContaining([
        expect.objectContaining({ partnerCodeId: 'code', amountCents: discountPct === 0 ? 5000 : 0 }),
      ]));
    }
  });

  it('uses checkout terms and provider payment time despite later edits or delayed delivery', async () => {
    const partners = harness();
    await recordOrderCommissions(order, partners, { nextId: () => 'commission' }, {
      paidAt: '2026-10-10T12:00:00.000Z',
      terms: { commissionPct: 60, discountPct: 20, graceDays: 30 },
    });
    expect(partners.createCommissions).toHaveBeenCalledWith('tenant', expect.arrayContaining([
      expect.objectContaining({ baseCents: 10000, pct: 40, amountCents: 4000, payableAt: '2026-11-09T12:00:00.000Z', createdAt: '2026-10-10T12:00:00.000Z' }),
    ]));
  });
});
