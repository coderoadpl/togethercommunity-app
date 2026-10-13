import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { err, ok, partnerCodeSchema, partnerProgramSchema, salesLinkSchema, validation, type CheckoutSnapshot } from '#core/domain/index.js';
import type { Db } from './client.js';
import { members, orders, partnerEvents, products, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';
import { createPartnerRepository } from './partner-repositories.js';
import { createCheckoutSnapshotRepository } from './checkout-snapshots.js';
import { createPaymentTransactionPort } from './payment-transaction.js';
import { createSalesLinkRepository } from './sales-links.js';

const now = '2026-10-13T12:00:00.000Z';
const tenantId = 'workspace';
const program = partnerProgramSchema.parse({ id: 'program', tenantId, name: 'Program', commissionPct: 50, createdAt: now, revision: 1 });
const code = partnerCodeSchema.parse({ id: 'code', tenantId, programId: program.id, partnerId: 'partner', code: 'ONLY-ONE', discountPct: 0, maxRedemptions: 1, salesLinkIds: ['offer'], stripeCouponId: null, stripePromotionCodeId: null, createdAt: now, revision: 1 });
const snapshot = (id: string): CheckoutSnapshot => ({ id, tenantId, salesLinkId: 'offer', lines: [{ productId: 'product', name: 'Course', productType: 'course', grossCents: 10000, netCents: 10000, vatCents: 0, vatRate: 'exempt', vatExemptionBasis: 'Small business exemption', issuedCount: null }], currency: 'PLN', partnerCodeId: code.id, discountCents: 0, partnerTerms: { commissionPct: 50, discountPct: 0, graceDays: 14 }, createdAt: now });

describe('partner checkout capacity', () => {
  let db: Db;
  let close: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    ({ db, close } = await createTestDatabase('together_partner_capacity', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together'));
    await db.insert(tenants).values({ id: tenantId, slug: 'workspace', name: 'Workspace', createdAt: now });
    await db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
    await db.insert(members).values({ id: 'member', tenantId, userId: 'buyer', email: 'buyer@example.org', displayName: 'Buyer', createdAt: now });
    await db.insert(products).values({ id: 'product', tenantId, type: 'course', description: '', slug: 'course', title: 'Course', priceCents: 10000, currency: 'PLN', published: true, accessItems: [], vatRate: 23, createdAt: now });
    expect(await createSalesLinkRepository(db).save(tenantId, salesLinkSchema.parse({ id: 'offer', tenantId, slug: 'offer', title: 'Offer', heading: 'Offer', productIds: ['product'], allowsCodes: true, revision: 1, createdAt: now, updatedAt: now }), null)).toMatchObject({ ok: true });
    const repo = createPartnerRepository(db);
    expect(await repo.saveProgram(tenantId, program, null)).toMatchObject({ ok: true });
    expect(await repo.savePartner(tenantId, { id: 'partner', tenantId, programId: program.id, memberId: 'member', status: 'active', createdAt: now })).toMatchObject({ ok: true });
    expect(await repo.saveCode(tenantId, code, null)).toMatchObject({ ok: true });
  });
  afterAll(async () => { await close?.(); });

  it('reserves only one concurrent session, releases only once and counts payment only once', async () => {
    const repo = createPartnerRepository(db);
    const attempts = await Promise.all(['first', 'second'].map(async (id) => ({ id, result: await repo.reserveCheckout(tenantId, snapshot(id)) })));
    expect(attempts.filter(({ result }) => result.ok)).toHaveLength(1);
    expect(await repo.countRedemptions(tenantId, code.id)).toBe(1);
    const winner = attempts.find(({ result }) => result.ok);
    if (winner === undefined) throw new Error('Missing successful reservation');
    await repo.releaseCheckout('another-workspace', winner.id, now);
    expect(await repo.countRedemptions(tenantId, code.id)).toBe(1);
    await repo.releaseCheckout(tenantId, winner.id, now);
    await repo.releaseCheckout(tenantId, winner.id, now);
    expect(await repo.countRedemptions(tenantId, code.id)).toBe(0);
    expect(await repo.reserveCheckout(tenantId, snapshot('replacement'))).toEqual(ok(undefined));
    await repo.attachCheckoutSession(tenantId, 'replacement', 'cs_paid');
    expect(await createCheckoutSnapshotRepository(db).findById(tenantId, 'replacement')).toMatchObject({ providerSessionId: 'cs_paid' });
    const pay = async (abort: boolean) => createPaymentTransactionPort(db).run(async (transaction) => {
      await transaction.orders.create(tenantId, { mode: 'live', priceId: null, discountCents: 0, couponId: null, id: 'order', tenantId, memberId: 'member', productId: 'product', kind: 'one_time', status: 'paid', amountCents: 10000, currency: 'PLN', provider: 'stripe', providerObjectIds: { checkoutSession: 'cs_paid' }, partnerCodeId: code.id, createdAt: now });
      const result = await transaction.partners?.completeCheckout(tenantId, 'replacement', 'order', now);
      if (result === undefined) throw new Error('Missing transaction partner repository');
      return abort ? err(validation('Abort fulfillment')) : result;
    });
    expect(await pay(true)).toMatchObject({ ok: false });
    expect(await repo.countRedemptions(tenantId, code.id)).toBe(1);
    expect(await db.select().from(orders)).toHaveLength(0);
    expect(await pay(false)).toEqual(ok(undefined));
    expect(await repo.completeCheckout(tenantId, 'replacement', 'order', now)).toEqual(ok(undefined));
    await repo.releaseCheckout(tenantId, 'replacement', now);
    expect(await repo.countRedemptions(tenantId, code.id)).toBe(1);
    expect(await repo.reserveCheckout(tenantId, snapshot('over-cap'))).toMatchObject({ ok: false });
    expect(await db.select().from(partnerEvents).where(eq(partnerEvents.entityId, 'replacement'))).toHaveLength(2);
    await createCheckoutSnapshotRepository(db).create(tenantId, snapshot('legacy'));
    await db.insert(orders).values({ id: 'another-order', tenantId, memberId: 'member', productId: 'product', kind: 'one_time', status: 'paid', amountCents: 10000, currency: 'PLN', provider: 'stripe', partnerCodeId: code.id, createdAt: now });
    expect(await repo.completeCheckout(tenantId, 'legacy', 'another-order', now)).toMatchObject({ ok: false });
  });
});
