import { afterAll, beforeAll, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { commissionSchema, memberTombstone, partnerCodeSchema, partnerProgramSchema, salesLinkSchema } from '#core/domain/index.js';
import { validatePartnerCodeForCheckout } from '#core/server/usecases/partner-checkout.js';
import type { Db } from './client.js';
import { createMemberErasureRepository } from './repositories.js';
import { createPartnerRepository } from './partner-repositories.js';
import { createSalesLinkRepository } from './sales-links.js';
import { commissions, members, orders, partnerCodes, partnerEvents, partnerPrograms, partners, products, salesLinks, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const now = '2026-10-13T12:00:00.000Z';
const removedAt = '2026-10-14T12:00:00.000Z';
const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
let db: Db;
let close: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ db, close } = await createTestDatabase('together_partner_erasure_test', baseDatabaseUrl));
});
afterAll(async () => { await close?.(); });

it('archives partner memberships and codes, retains financial history, and prevents reactivation after erasure', async () => {
  await db.insert(user).values({ id: 'shared-user', name: 'Partner', email: 'partner@example.org' });
  for (const tenantId of ['workspace', 'other']) {
    await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: tenantId, createdAt: now });
    await db.insert(members).values({ id: `member-${tenantId}`, tenantId, userId: 'shared-user', email: 'partner@example.org', createdAt: now });
    await db.insert(partnerPrograms).values(partnerProgramSchema.parse({ id: `program-${tenantId}`, tenantId, name: 'Program', commissionPct: 50, createdAt: now, revision: 1 }));
    await db.insert(partners).values({ id: `partner-${tenantId}`, tenantId, programId: `program-${tenantId}`, memberId: `member-${tenantId}`, status: 'active', createdAt: now });
    await db.insert(products).values({ id: `product-${tenantId}`, tenantId, type: 'course', slug: 'course', title: 'Course', description: '', priceCents: 10000, currency: 'PLN', published: true, accessItems: [], createdAt: now });
    await db.insert(salesLinks).values(salesLinkSchema.parse({ id: `offer-${tenantId}`, tenantId, slug: 'offer', title: 'Offer', heading: 'Offer', productIds: [`product-${tenantId}`], active: true, allowsCodes: true, revision: 1, createdAt: now, updatedAt: now }));
    await db.insert(partnerCodes).values(partnerCodeSchema.parse({ id: `code-${tenantId}`, tenantId, programId: `program-${tenantId}`, partnerId: `partner-${tenantId}`, code: 'FRIEND10', discountPct: 10, salesLinkIds: [`offer-${tenantId}`], stripeCouponId: 'coupon', stripePromotionCodeId: `promotion-${tenantId}`, createdAt: now, revision: 1 }));
  }
  const repo = createPartnerRepository(db);
  const code = await repo.findCode('workspace', 'code-workspace');
  const partner = await repo.findPartner('workspace', 'partner-workspace');
  if (code === null || partner === null) throw new Error('Missing fixture');
  await db.insert(partnerCodes).values({ ...code, id: 'archived-code', code: 'ARCHIVED', status: 'archived', stripePromotionCodeId: 'archived-promotion' });
  await db.insert(orders).values({ id: 'order', tenantId: 'workspace', memberId: 'member-workspace', productId: 'product-workspace', kind: 'one_time', status: 'paid', amountCents: 9000, currency: 'PLN', provider: 'stripe', providerObjectIds: {}, partnerCodeId: code.id, createdAt: now });
  const commission = commissionSchema.parse({ id: 'commission', tenantId: 'workspace', orderId: 'order', orderLineId: 'line', programId: code.programId, partnerId: code.partnerId, partnerCodeId: code.id, baseCents: 10000, pct: 40, amountCents: 4000, status: 'pending', voidedReason: null, payoutId: null, payableAt: '2026-10-27T12:00:00.000Z', createdAt: now });
  await repo.createCommissions('workspace', [commission]);
  const historicalEvents = await db.select().from(partnerEvents);
  const ledger = await db.select().from(commissions);
  const checkoutInput = { code: code.code, salesLinkId: 'offer-workspace', amountCents: 10000, currency: 'PLN' };
  const checkoutDeps = { partners: repo, salesLinks: createSalesLinkRepository(db), clock: { nowIso: () => removedAt } };
  expect(await validatePartnerCodeForCheckout('workspace', checkoutInput, checkoutDeps)).toMatchObject({ ok: true, value: { code: { id: code.id } } });

  const erasure = createMemberErasureRepository(db, { compute: (tenantId, email) => `${tenantId}:${email}` });
  const tombstone = memberTombstone(partner.memberId);
  const input = { memberId: partner.memberId, deletedAt: removedAt, tombstoneEmail: tombstone.email, severedUserId: tombstone.userId, postAuthorDisplay: 'Deleted member' };
  const result = await erasure.pseudonymize('workspace', input);
  expect(result?.partnerPromotionCodeIds.sort()).toEqual(['archived-promotion', 'promotion-workspace']);
  expect(await repo.findPartner('workspace', partner.id)).toMatchObject({ status: 'archived' });
  expect(await repo.findCode('workspace', code.id)).toMatchObject({ status: 'archived', revision: 2 });
  expect(await validatePartnerCodeForCheckout('workspace', checkoutInput, checkoutDeps)).toMatchObject({ ok: false, error: { code: 'validation' } });
  expect(await repo.savePartner('workspace', partner)).toMatchObject({ ok: false });
  expect(await repo.savePartner('workspace', { ...partner, id: 'new-partner' })).toMatchObject({ ok: false });
  expect(await repo.saveCode('workspace', { ...code, revision: 3 }, 2)).toMatchObject({ ok: false });
  expect(await repo.saveCode('workspace', { ...code, id: 'new-code', code: 'NEW' }, null)).toMatchObject({ ok: false });
  expect(await repo.findPartner('other', 'partner-other')).toMatchObject({ status: 'active' });
  expect(await repo.findCode('other', 'code-other')).toMatchObject({ status: 'active', revision: 1 });
  expect(await db.select().from(commissions)).toEqual(ledger);
  const events = await db.select().from(partnerEvents);
  expect(events).toEqual(expect.arrayContaining(historicalEvents));
  expect(events.filter((event) => event.type === 'member-erased')).toHaveLength(2);
  expect(await erasure.pseudonymize('workspace', input)).toMatchObject({ alreadyDeleted: true, partnerPromotionCodeIds: expect.arrayContaining(['promotion-workspace', 'archived-promotion']) });
  expect(await db.select().from(partnerEvents)).toEqual(events);
  expect(await db.select().from(members).where(and(eq(members.tenantId, 'workspace'), eq(members.id, partner.memberId)))).toMatchObject([{ email: tombstone.email }]);
});
