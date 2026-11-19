import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DELETED_MEMBER_DISPLAY, memberTombstone, orderLineSchema, orderListItemSchema, orderSchema, productSchema, type OrderLinePersonalization, type Product } from '#core/domain/index.js';

import { createCheckoutSnapshotRepository } from './checkout-snapshots.js';
import { createOrderPersonalizationRepository } from './order-fulfilment.js';
import { createMemberErasureRepository, createOrderRepository, createProductRepository } from './repositories.js';
import { checkoutSnapshots, emailOutbox, members, orderChanges, orders, products, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const now = '2026-11-18T09:00:00.000Z';
const condition = 'I understand a personalised item is made to my order.';
const personalization: OrderLinePersonalization = {
  text: 'For Alex, with love', label: 'Add an engraving', description: 'Up to three short lines.', inputLabel: 'Engraving text',
  condition, maxLength: 40, requestedAt: now, conditionAcceptedAt: now,
};
const personalizedLine = orderLineSchema.parse({
  productId: 'book', name: 'Printed book', productType: 'physical', grossCents: 4900, netCents: 4667, vatCents: 233, vatRate: 5,
  vatExemptionBasis: null, issuedCount: 0, personalization,
});
const plainLine = orderLineSchema.parse({
  productId: 'poster', name: 'Poster', productType: 'physical', grossCents: 2000, netCents: 1852, vatCents: 148, vatRate: 8,
  vatExemptionBasis: null, issuedCount: 0,
});
const order = (id: string, memberId = 'member') => orderSchema.parse({
  id, tenantId: 'workspace', memberId, productId: 'book', priceId: null, kind: 'one_time', status: 'paid',
  amountCents: 6900, currency: 'PLN', provider: 'simulated', providerObjectIds: { checkoutSession: `cs-${id}` }, couponId: null,
  discountCents: 0, lines: [personalizedLine, plainLine], createdAt: now, paidAt: now,
});
let database: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  database = await createTestDatabase('together_order_personalization', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values(['workspace', 'other'].map((id) => ({ id, slug: id, name: id, createdAt: now })));
  await database.db.insert(user).values([{ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' }, { id: 'keeper', email: 'keeper@example.org', name: 'Keeper' }]);
  await database.db.insert(members).values([
    { id: 'member', tenantId: 'workspace', userId: 'buyer', email: 'buyer@example.org', displayName: 'Buyer', createdAt: now },
    { id: 'keeper-member', tenantId: 'workspace', userId: 'keeper', email: 'keeper@example.org', displayName: 'Keeper', createdAt: now },
  ]);
  await database.db.insert(products).values([
    { id: 'book', tenantId: 'workspace', type: 'physical', slug: 'book', title: 'Printed book', description: '', priceCents: 4900, currency: 'PLN', published: true, vatRate: 5, createdAt: now },
    { id: 'poster', tenantId: 'workspace', type: 'physical', slug: 'poster', title: 'Poster', description: '', priceCents: 2000, currency: 'PLN', published: true, vatRate: 8, createdAt: now },
  ]);
  const repository = createOrderRepository(database.db);
  for (const id of ['corrected', 'erased']) await repository.create('workspace', order(id));
  await repository.create('workspace', order('kept', 'keeper-member'));
}, 60_000);
afterAll(async () => { await database?.close(); });

describe('product personalisation storage', () => {
  it('stores the setting, keeps it on an update without the field and clears it with null', async () => {
    const repository = createProductRepository(database.db);
    const stored = await repository.findById('workspace', 'book');
    if (stored === null) throw new Error('Product was not stored');
    expect(stored.personalization ?? null).toBeNull();
    const setting = { label: 'Add an engraving', description: '', inputLabel: 'Engraving text', maxLength: 40, condition };
    const version = (id: string) => ({ id, entityKind: 'product' as const, entityId: 'book', schemaVersion: 10, payload: {}, createdAt: now, createdBy: null });
    const withoutField = productSchema.omit({ personalization: true }).parse(stored);
    const set: Product = { ...stored, personalization: setting };
    expect(await repository.update('workspace', set, version('v1'))).toMatchObject({ personalization: setting });
    expect(await repository.update('workspace', { ...withoutField, title: 'Printed book, signed' }, version('v2'))).toMatchObject({ title: 'Printed book, signed', personalization: setting });
    expect(await repository.update('workspace', { ...withoutField, personalization: null }, version('v3'))).toMatchObject({ personalization: null });
  });
});

describe('order personalisation correction', () => {
  it('keeps the first original text across corrections, changes only that line and records an order change', async () => {
    const repository = createOrderPersonalizationRepository(database.db);
    const changesBefore = (await database.db.select().from(orderChanges).where(and(eq(orderChanges.tenantId, 'workspace'), eq(orderChanges.orderId, 'corrected')))).length;
    const first = await repository.correctPersonalization('workspace', { orderId: 'corrected', productId: 'book', text: '  For Alex  ', editedAt: '2026-11-18T10:00:00.000Z', editedBy: 'staff-1' });
    expect(first).toMatchObject({ ok: true, value: { lines: [{ personalization: { text: 'For Alex', originalText: 'For Alex, with love', editedBy: 'staff-1', condition, conditionAcceptedAt: now } }, plainLine] } });
    const second = await repository.correctPersonalization('workspace', { orderId: 'corrected', productId: 'book', text: 'For Sam', editedAt: '2026-11-18T11:00:00.000Z', editedBy: 'staff-2' });
    expect(second).toMatchObject({ ok: true, value: { lines: [{ personalization: { text: 'For Sam', originalText: 'For Alex, with love', editedAt: '2026-11-18T11:00:00.000Z', editedBy: 'staff-2' } }, plainLine] } });
    const changesAfter = (await database.db.select().from(orderChanges).where(and(eq(orderChanges.tenantId, 'workspace'), eq(orderChanges.orderId, 'corrected')))).length;
    expect(changesAfter).toBe(changesBefore + 2);
    const listed = await createOrderRepository(database.db).list('workspace', { page: 1, pageSize: 20 });
    expect(listed.orders.find((item) => item.id === 'corrected')?.lines?.[0]?.personalization).toMatchObject({ text: 'For Sam', originalText: 'For Alex, with love' });
    expect(orderListItemSchema.array().parse(JSON.parse(JSON.stringify(listed.orders))).find((item) => item.id === 'corrected')?.lines?.[0]?.personalization?.text).toBe('For Sam');
  });

  it('refuses a text over the stored limit, a line without personalisation and an order of another workspace', async () => {
    const repository = createOrderPersonalizationRepository(database.db);
    const correction = { orderId: 'corrected', editedAt: now, editedBy: 'staff-1' };
    expect(await repository.correctPersonalization('workspace', { ...correction, productId: 'book', text: 'x'.repeat(41) })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await repository.correctPersonalization('workspace', { ...correction, productId: 'poster', text: 'Hello' })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await repository.correctPersonalization('other', { ...correction, productId: 'book', text: 'Hello' })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await repository.correctPersonalization('workspace', { ...correction, orderId: 'missing', productId: 'book', text: 'Hello' })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect((await createOrderRepository(database.db).findById('workspace', 'corrected'))?.lines?.[0]?.personalization?.text).toBe('For Sam');
  });
});

describe('member erasure of personalisation text', () => {
  it('replaces the typed and original text on orders, checkout snapshots and purchase e-mails of the erased member only', async () => {
    await createOrderPersonalizationRepository(database.db).correctPersonalization('workspace', { orderId: 'erased', productId: 'book', text: 'Edited text', editedAt: now, editedBy: 'staff-1' });
    const snapshots = createCheckoutSnapshotRepository(database.db);
    for (const [id, session] of [['snapshot-erased', 'cs-erased'], ['snapshot-kept', 'cs-kept']] as const) {
      await snapshots.create('workspace', { id, tenantId: 'workspace', salesLinkId: null, lines: [personalizedLine, plainLine], currency: 'PLN', providerSessionId: session, createdAt: now });
    }
    const confirmation = (id: string, to: string) => ({
      id, tenantId: 'workspace', kind: 'welcome-sign-in', to, nextAttemptAt: now, createdAt: now,
      payload: {
        kind: 'welcome-sign-in', language: 'en', tenantName: 'Workspace', actionUrl: 'https://workspace.example.org/sign-in', productType: 'physical',
        purchase: {
          orderNumber: 'ORDER-1', verificationUrl: 'https://workspace.example.org/verify', qrImageUrl: 'https://workspace.example.org/qr.png',
          lines: ['Printed book', 'Poster'], personalizations: [{ name: 'Printed book', text: 'For Alex, with love', condition }],
        },
      },
    });
    await database.db.insert(emailOutbox).values([confirmation('outbox-erased', ' Buyer@Example.org '), confirmation('outbox-kept', 'keeper@example.org')]);

    await createMemberErasureRepository(database.db, { compute: (tenantId, email) => `${tenantId}:${email}` }).pseudonymize('workspace', {
      memberId: 'member', deletedAt: now, tombstoneEmail: memberTombstone('member').email,
      severedUserId: memberTombstone('member').userId, postAuthorDisplay: DELETED_MEMBER_DISPLAY,
    });

    const orderRepository = createOrderRepository(database.db);
    expect((await orderRepository.findById('workspace', 'erased'))?.lines).toMatchObject([
      { ...personalizedLine, personalization: { ...personalization, text: DELETED_MEMBER_DISPLAY, originalText: DELETED_MEMBER_DISPLAY, editedAt: now, editedBy: 'staff-1' } },
      plainLine,
    ]);
    expect((await orderRepository.findById('workspace', 'corrected'))?.lines?.[0]?.personalization).toMatchObject({ text: DELETED_MEMBER_DISPLAY, originalText: DELETED_MEMBER_DISPLAY });
    expect((await orderRepository.findById('workspace', 'kept'))?.lines).toMatchObject([personalizedLine, plainLine]);
    const snapshotLines = async (id: string) => (await database.db.select({ lines: checkoutSnapshots.lines }).from(checkoutSnapshots).where(eq(checkoutSnapshots.id, id)))[0]?.lines;
    expect(await snapshotLines('snapshot-erased')).toEqual([{ ...personalizedLine, personalization: { ...personalization, text: DELETED_MEMBER_DISPLAY } }, plainLine]);
    expect(await snapshotLines('snapshot-kept')).toEqual([personalizedLine, plainLine]);
    const payload = async (id: string) => (await database.db.select({ payload: emailOutbox.payload }).from(emailOutbox).where(eq(emailOutbox.id, id)))[0]?.payload;
    expect(await payload('outbox-erased')).toMatchObject({ purchase: { lines: ['Printed book', 'Poster'], personalizations: [{ name: 'Printed book', text: DELETED_MEMBER_DISPLAY, condition }] } });
    expect(await payload('outbox-kept')).toMatchObject({ purchase: { personalizations: [{ text: 'For Alex, with love' }] } });
    expect((await orderRepository.findById('workspace', 'erased'))?.amountCents).toBe(6900);
    expect(await database.db.select({ id: orders.id }).from(orders).where(eq(orders.memberId, 'member'))).toHaveLength(2);
  });
});
