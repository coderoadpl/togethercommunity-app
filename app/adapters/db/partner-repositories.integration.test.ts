import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { err, validation, commissionSchema, couponSchema, partnerCodeSchema, partnerProgramSchema, salesLinkSchema } from '#core/domain/index.js';
import type { Db } from './client.js';
import { members, orders, partnerEvents, products, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';
import { createPartnerRepository } from './partner-repositories.js';
import { createCouponRepository } from './coupon-repositories.js';
import { createPaymentTransactionPort } from './payment-transaction.js';
import { createOrderRepository } from './repositories.js';
import { createSalesLinkRepository } from './sales-links.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const now = '2026-10-13T12:00:00.000Z';
const program = partnerProgramSchema.parse({ id: 'program', tenantId: 'workspace', name: 'Referral program', commissionPct: 50, createdAt: now, revision: 1 });
const offer = salesLinkSchema.parse({ id: 'offer', tenantId: 'workspace', slug: 'offer', title: 'Offer', heading: 'Offer', productIds: ['product'], active: true, allowsCodes: true, revision: 1, createdAt: now, updatedAt: now });
const code = partnerCodeSchema.parse({ id: 'code', tenantId: 'workspace', programId: program.id, partnerId: 'partner', code: 'FRIEND10', discountPct: 10, salesLinkIds: ['offer'], stripeCouponId: null, stripePromotionCodeId: null, createdAt: now, revision: 1 });
describe('partner persistence', () => {
  let db: Db;
  let close: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    ({ db, close } = await createTestDatabase('together_partner_programs', baseDatabaseUrl));
    await db.insert(tenants).values([{ id: 'workspace', slug: 'workspace', name: 'Workspace', createdAt: now }, { id: 'other', slug: 'other', name: 'Other', createdAt: now }]);
    await db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
    await db.insert(members).values({ id: 'member', tenantId: 'workspace', userId: 'buyer', email: 'buyer@example.org', displayName: 'Buyer', createdAt: now });
    await db.insert(products).values({ id: 'product', tenantId: 'workspace', type: 'course', description: '', slug: 'course', title: 'Course', priceCents: 10000, currency: 'PLN', published: true, accessItems: [], vatRate: 23, createdAt: now });
    expect(await createSalesLinkRepository(db).save('workspace', offer, null)).toMatchObject({ ok: true });
  });
  afterAll(async () => { await close?.(); });
  it('isolates programs and partners and records revision history', async () => {
    const repo = createPartnerRepository(db);
    expect(await repo.saveProgram('workspace', program, null)).toMatchObject({ ok: true });
    expect(await repo.findProgram('other', program.id)).toBeNull();
    expect(await repo.saveProgram('other', { ...program, revision: 2 }, 1)).toMatchObject({ ok: false });
    expect(await repo.savePartner('workspace', { id: 'partner', tenantId: 'workspace', programId: program.id, memberId: 'member', createdAt: now, status: 'active' })).toMatchObject({ ok: true });
    expect(await repo.savePartner('other', { id: 'foreign', tenantId: 'other', programId: program.id, memberId: 'member', createdAt: now, status: 'active' })).toMatchObject({ ok: false });
    expect(await repo.savePartner('workspace', { id: 'duplicate', tenantId: 'workspace', programId: program.id, memberId: 'member', createdAt: now, status: 'active' })).toMatchObject({ ok: false });
    const clock = vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(now);
    try {
      for (const status of ['archived', 'active'] as const) {
        expect(await repo.savePartner('workspace', { id: 'partner', tenantId: 'workspace', programId: program.id, memberId: 'member', createdAt: now, status })).toMatchObject({ ok: true });
      }
      expect(await db.select().from(partnerEvents).where(eq(partnerEvents.entityId, 'partner'))).toHaveLength(3);
    } finally {
      clock.mockRestore();
    }
    const updates = await Promise.all(['First', 'Second'].map((name) => repo.saveProgram('workspace', { ...program, name, revision: 2 }, 1)));
    expect(updates.filter((result) => result.ok)).toHaveLength(1);
    expect(await db.select().from(partnerEvents).where(eq(partnerEvents.entityId, program.id))).toHaveLength(2);
  });
  it('enforces namespace uniqueness in both directions and offer checks', async () => {
    const repo = createPartnerRepository(db);
    expect(await repo.saveCode('workspace', code, null)).toMatchObject({ ok: true });
    expect(await repo.findCodeByCode('workspace', 'friend10')).toMatchObject({ id: code.id });
    expect(await repo.findCode('other', code.id)).toBeNull();
    expect(await repo.saveCode('workspace', { ...code, id: 'duplicate' }, null)).toMatchObject({ ok: false });
    expect(await repo.hasActiveCodeForSalesLink('workspace', 'offer')).toBe(true);
    expect(await repo.hasActiveCodeForSalesLink('other', 'offer')).toBe(false);
    const coupons = createCouponRepository(db);
    const coupon = couponSchema.parse({ id: 'coupon', tenantId: 'workspace', code: 'friend10', kind: 'percent', value: 10, scope: { kind: 'all' }, appliesTo: 'both', recurringDuration: 'first_invoice', startsAt: null, endsAt: null, maxRedemptions: null, maxRedemptionsPerMember: null, status: 'active', partnerLabel: null, stripeCouponId: null, stripePromotionCodeId: null, createdAt: now });
    expect(await coupons.create('workspace', coupon, { id: 'event', tenantId: 'workspace', couponId: coupon.id, type: 'created', occurredAt: now })).toBeNull();
    expect(await coupons.create('workspace', { ...coupon, code: 'REGULAR' }, { id: 'event', tenantId: 'workspace', couponId: coupon.id, type: 'created', occurredAt: now })).not.toBeNull();
    expect(await repo.saveCode('workspace', { ...code, id: 'collision', code: 'REGULAR' }, null)).toMatchObject({ ok: false });
  });
  it('serializes offer disabling with code creation and allows archiving after offer deletion', async () => {
    const repo = createPartnerRepository(db);
    const links = createSalesLinkRepository(db);
    const concurrentOffer = { ...offer, id: 'concurrent-offer', slug: 'concurrent-offer' };
    expect(await links.save('workspace', concurrentOffer, null)).toMatchObject({ ok: true });
    const concurrentCode = { ...code, id: 'concurrent-code', code: 'CONCURRENT', salesLinkIds: [concurrentOffer.id] };
    const results = await Promise.all([
      links.save('workspace', { ...concurrentOffer, allowsCodes: false, revision: 2 }, 1),
      repo.saveCode('workspace', concurrentCode, null),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const savedOffer = await links.findById('workspace', concurrentOffer.id);
    const savedCode = await repo.findCode('workspace', concurrentCode.id);
    expect(savedOffer?.allowsCodes || savedCode === null).toBe(true);
    expect(await repo.saveCode('workspace', { ...code, id: 'missing-offer-code', code: 'MISSING', salesLinkIds: ['missing'] }, null)).toMatchObject({ ok: false });
    expect(await links.save('workspace', { ...offer, allowsCodes: false, revision: 2 }, 1)).toMatchObject({ ok: false, error: { code: 'validation' } });
    const deletedOffer = { ...offer, id: 'deleted-offer', slug: 'deleted-offer' };
    expect(await links.save('workspace', deletedOffer, null)).toMatchObject({ ok: true });
    const orphanedCode = { ...code, id: 'orphaned-code', code: 'ORPHANED', salesLinkIds: [deletedOffer.id] };
    expect(await repo.saveCode('workspace', orphanedCode, null)).toMatchObject({ ok: true });
    expect(await links.delete('workspace', deletedOffer.id, now)).toMatchObject({ ok: true });
    expect(await repo.saveCode('workspace', { ...orphanedCode, status: 'archived', revision: 2 }, 1)).toMatchObject({ ok: true });
    expect(await repo.saveCode('workspace', { ...orphanedCode, revision: 3 }, 2)).toMatchObject({ ok: false });
  });
  it('rejects stale checkout promotion writes after a code edit', async () => {
    const repo = createPartnerRepository(db);
    const editable = { ...code, id: 'editable-code', code: 'EDITABLE', stripeCouponId: 'original-coupon', stripePromotionCodeId: 'original-promotion' };
    expect(await repo.saveCode('workspace', editable, null)).toMatchObject({ ok: true });
    const revised = { ...editable, revision: 2, discountPct: 20, stripeCouponId: 'revised-coupon', stripePromotionCodeId: 'revised-promotion' };
    expect(await repo.saveCode('workspace', revised, 1)).toMatchObject({ ok: true });
    expect(await repo.cacheStripeIds('workspace', editable.id, { stripeCouponId: 'original-coupon', stripePromotionCodeId: 'original-promotion' }, 1)).toBeNull();
    expect(await repo.findCode('workspace', editable.id)).toMatchObject({ revision: 2, stripeCouponId: 'revised-coupon', stripePromotionCodeId: 'revised-promotion' });
    expect(await repo.cacheStripeIds('other', editable.id, { stripeCouponId: 'foreign-coupon', stripePromotionCodeId: 'foreign-promotion' }, 2)).toBeNull();
    expect(await repo.cacheStripeIds('workspace', editable.id, { stripeCouponId: 'revised-coupon', stripePromotionCodeId: 'revised-promotion' }, 2)).toMatchObject({ revision: 2 });
    expect(await repo.saveCode('workspace', { ...revised, status: 'archived', revision: 3 }, 2)).toMatchObject({ ok: true });
    expect(await repo.cacheStripeIds('workspace', editable.id, { stripeCouponId: 'revised-coupon', stripePromotionCodeId: 'revised-promotion' }, 3)).toBeNull();
  });
  it('serializes commission reductions with code creation', async () => {
    const repo = createPartnerRepository(db);
    const concurrentProgram = { ...program, id: 'concurrent-program' };
    expect(await repo.saveProgram('workspace', concurrentProgram, null)).toMatchObject({ ok: true });
    const concurrentPartner = { id: 'concurrent-partner', tenantId: 'workspace', programId: concurrentProgram.id, memberId: 'member', createdAt: now, status: 'active' as const };
    expect(await repo.savePartner('workspace', concurrentPartner)).toMatchObject({ ok: true });
    const concurrentCode = { ...code, id: 'high-discount-code', code: 'HIGH-DISCOUNT', programId: concurrentProgram.id, partnerId: concurrentPartner.id, discountPct: 40 };
    const results = await Promise.all([
      repo.saveProgram('workspace', { ...concurrentProgram, commissionPct: 10, revision: 2 }, 1),
      repo.saveCode('workspace', concurrentCode, null),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const savedProgram = await repo.findProgram('workspace', concurrentProgram.id);
    const savedCode = await repo.findCode('workspace', concurrentCode.id);
    expect(savedCode === null || savedCode.discountPct <= (savedProgram?.commissionPct ?? 0)).toBe(true);
    expect(await repo.saveProgram('workspace', { ...program, commissionPct: 5, revision: 3 }, 2)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
  it('creates one entry per order line and preserves earned commissions on late refund', async () => {
    const repo = createPartnerRepository(db);
    await db.insert(orders).values({ id: 'order', tenantId: 'workspace', memberId: 'member', productId: 'product', kind: 'one_time', status: 'paid', amountCents: 10000, currency: 'PLN', provider: 'simulated', partnerCodeId: code.id, createdAt: now });
    const entry = commissionSchema.parse({ id: 'commission', tenantId: 'workspace', orderId: 'order', orderLineId: 'order:product', programId: program.id, partnerId: 'partner', partnerCodeId: code.id, baseCents: 10000, pct: 40, amountCents: 4000, status: 'pending', payableAt: '2026-10-27T12:00:00.000Z', voidedReason: null, payoutId: null, createdAt: now });
    const rolledBack = await createPaymentTransactionPort(db).run(async (transaction) => {
      await transaction.partners?.createCommissions('workspace', [entry]);
      return err(validation('Abort fulfillment'));
    });
    expect(rolledBack).toMatchObject({ ok: false });
    expect(await repo.listCommissions('workspace', program.id, now)).toHaveLength(0);
    expect(await db.select().from(partnerEvents).where(eq(partnerEvents.entityId, entry.id))).toHaveLength(0);
    await repo.createCommissions('workspace', [entry]);
    await repo.createCommissions('workspace', [{ ...entry, id: 'retry' }]);
    expect(await repo.listCommissions('workspace', program.id, now)).toHaveLength(1);
    expect(await repo.listCommissions('other', program.id, now)).toHaveLength(0);
    expect(await repo.listCommissions('workspace', program.id, entry.payableAt)).toMatchObject([{ status: 'payable' }]);
    expect(await createOrderRepository(db).findById('workspace', 'order')).toMatchObject({ partnerCodeId: code.id });
    expect(await createOrderRepository(db).findById('workspace', 'order')).toMatchObject({ partnerAttribution: { code: 'FRIEND10', memberEmail: 'buyer@example.org' } });
    await db.update(orders).set({ status: 'refunded' }).where(eq(orders.id, 'order'));
    await repo.voidPendingCommissions('workspace', 'order', 'refunded', entry.payableAt);
    expect(await repo.listCommissions('workspace', program.id, entry.payableAt)).toMatchObject([{ status: 'payable', voidedReason: null }]);
    await db.insert(orders).values({ id: 'early-order', tenantId: 'workspace', memberId: 'member', productId: 'product', kind: 'one_time', status: 'paid', amountCents: 10000, currency: 'PLN', provider: 'simulated', partnerCodeId: code.id, createdAt: now });
    await repo.createCommissions('workspace', [{ ...entry, id: 'early', orderId: 'early-order', orderLineId: 'early-order:product' }]);
    await repo.voidPendingCommissions('workspace', 'early-order', 'disputed', now);
    await repo.voidPendingCommissions('workspace', 'early-order', 'disputed', now);
    expect((await repo.listCommissions('workspace', program.id, now)).find((row) => row.id === 'early')).toMatchObject({ status: 'voided', voidedReason: 'disputed' });
    expect(await db.select().from(partnerEvents).where(eq(partnerEvents.entityId, 'early'))).toHaveLength(2);
  });
  it('voids unpaid commissions for an in-grace dispute delivered after a post-grace refund', async () => {
    const repo = createPartnerRepository(db);
    const orderId = 'reordered-adjustments';
    const payableAt = '2026-10-27T12:00:00.000Z';
    const refundedAt = '2026-10-28T12:00:00.000Z';
    const disputedAt = '2026-10-20T12:00:00.000Z';
    await db.insert(orders).values({ id: orderId, tenantId: 'workspace', memberId: 'member', productId: 'product', kind: 'one_time', status: 'refunded', amountCents: 20000, currency: 'PLN', provider: 'simulated', partnerCodeId: code.id, createdAt: now });
    const entries = ['first', 'second'].map((line) => commissionSchema.parse({ id: `${orderId}:${line}`, tenantId: 'workspace', orderId, orderLineId: `${orderId}:${line}`, programId: program.id, partnerId: 'partner', partnerCodeId: code.id, baseCents: 10000, pct: 40, amountCents: 4000, status: 'pending', payableAt, voidedReason: null, payoutId: null, createdAt: now }));
    await repo.createCommissions('workspace', entries);
    await repo.voidPendingCommissions('workspace', orderId, 'refunded', refundedAt);
    expect((await repo.listCommissions('workspace', program.id, refundedAt)).filter((row) => row.orderId === orderId)).toMatchObject([{ status: 'payable' }, { status: 'payable' }]);
    await repo.voidPendingCommissions('other', orderId, 'disputed', disputedAt);
    expect((await repo.listCommissions('workspace', program.id, refundedAt)).filter((row) => row.orderId === orderId)).toMatchObject([{ status: 'payable' }, { status: 'payable' }]);
    await repo.voidPendingCommissions('workspace', orderId, 'disputed', disputedAt);
    await repo.voidPendingCommissions('workspace', orderId, 'disputed', disputedAt);
    await repo.voidPendingCommissions('workspace', orderId, 'refunded', refundedAt);
    expect((await repo.listCommissions('workspace', program.id, refundedAt)).filter((row) => row.orderId === orderId)).toMatchObject([{ status: 'voided', voidedReason: 'disputed' }, { status: 'voided', voidedReason: 'disputed' }]);
    for (const entry of entries) {
      const events = await db.select().from(partnerEvents).where(eq(partnerEvents.entityId, entry.id));
      expect(events).toHaveLength(3);
      expect(events.find((event) => event.type === 'voided')).toMatchObject({ occurredAt: expect.stringContaining('2026-10-20') });
    }
  });
  it('preserves paid commissions when an in-grace adjustment arrives later', async () => {
    const repo = createPartnerRepository(db);
    const orderId = 'paid-commission-order';
    await db.insert(orders).values({ id: orderId, tenantId: 'workspace', memberId: 'member', productId: 'product', kind: 'one_time', status: 'refunded', amountCents: 10000, currency: 'PLN', provider: 'simulated', partnerCodeId: code.id, createdAt: now });
    const entry = commissionSchema.parse({ id: 'paid-commission', tenantId: 'workspace', orderId, orderLineId: `${orderId}:product`, programId: program.id, partnerId: 'partner', partnerCodeId: code.id, baseCents: 10000, pct: 40, amountCents: 4000, status: 'paid', payableAt: '2026-10-27T12:00:00.000Z', voidedReason: null, payoutId: 'payout', createdAt: now });
    await repo.createCommissions('workspace', [entry]);
    await repo.voidPendingCommissions('workspace', orderId, 'disputed', now);
    expect((await repo.listCommissions('workspace', program.id, now)).find((row) => row.id === entry.id)).toMatchObject({ status: 'paid', payoutId: 'payout', voidedReason: null });
    expect(await db.select().from(partnerEvents).where(eq(partnerEvents.entityId, entry.id))).toHaveLength(1);
  });
});
