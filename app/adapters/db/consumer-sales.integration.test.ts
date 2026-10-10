import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ksefInvoiceDataSchema, orderLineSchema, orderSchema, type Identity } from '#core/domain/index.js';
import { summarizeUninvoicedConsumerSales } from '#core/server/index.js';

import { createConsumerSalesRepository } from './consumer-sales.js';
import { coupons, invoiceEvents, invoices, members, orders, products, tenants, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const now = '2026-09-10T12:00:00.000Z';
const identity: Identity = { userId: 'staff', email: 'staff@example.org', name: 'Staff', emailVerified: true, image: null, tenantAccess: 'staff', tenantId: 'workspace', tenantSlug: 'workspace', tenantName: 'Workspace', staffRole: 'owner', memberId: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false };
const line = orderLineSchema.parse({ productId: 'product', name: 'Material', productType: 'digital_download', grossCents: 105, netCents: 100, vatCents: 5, vatRate: 5, vatExemptionBasis: null, issuedCount: null });
const acceptedKsef = ksefInvoiceDataSchema.parse({
  environment: 'test', schemaSystemCode: 'FA (3)', schemaVersion: '1-0E', contextNip: '5555555555', sellerName: 'Workspace', sellerAddress: 'Main Street 1', p2: 'FV/2026/1', invoiceType: 'VAT', issueDate: '2026-09-10',
  xmlArtifactKey: 'invoice/fa3.xml', xmlByteSize: 100, xmlSha256: 'a'.repeat(64), state: 'awaiting_upo', authConfigVersion: 1, sessionReference: 'session', invoiceReference: 'reference', ksefNumber: '5555555555-20260910-ABC-01',
  lastStatusCode: 200, lastStatusDescription: 'Accepted', lastStatusDetails: [], lastStatusExtensions: {}, lastPolledAt: now, acquisitionAt: now, invoicingAt: now, permanentStorageAt: now,
  upoArtifactKey: null, upoSha256: null, upoRetrievedAt: null, originalSessionReference: null, originalKsefNumber: null, lastTransportError: null, retryAt: null, attempt: 1, correlationChecks: 0, version: 1,
});
const excludedInvoiceStates = ['requested', 'queued', 'submitting', 'processing', 'conflict'] as const;
const order = (id: string, overrides: object = {}) => orderSchema.parse({ id, tenantId: 'workspace', memberId: 'member', productId: 'product', priceId: null, kind: 'one_time', status: 'paid', amountCents: 105, currency: 'PLN', provider: 'simulated', providerObjectIds: {}, couponId: null, discountCents: 0, lines: [line], createdAt: now, ...overrides });
let database: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  database = await createTestDatabase('together_consumer_sales', baseDatabaseUrl);
  await database.db.insert(tenants).values(['workspace', 'other'].map((id) => ({ id, slug: id, name: id, createdAt: now })));
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
  await database.db.insert(members).values(['workspace', 'other'].map((tenantId) => ({ id: tenantId === 'workspace' ? 'member' : 'other-member', tenantId, userId: 'buyer', email: 'buyer@example.org', displayName: 'Buyer', createdAt: now })));
  await database.db.insert(products).values(['workspace', 'other'].map((tenantId) => ({ id: tenantId === 'workspace' ? 'product' : 'other-product', tenantId, type: 'digital_download' as const, description: '', slug: 'material', title: 'Material', priceCents: 105, currency: 'PLN', vatRate: 5 as const, createdAt: now })));
  await database.db.insert(products).values({ id: 'inherited-product', tenantId: 'workspace', type: 'digital_download', description: '', slug: 'inherited-material', title: 'Inherited material', priceCents: 105, currency: 'PLN', vatRate: null, createdAt: now });
  await database.db.insert(coupons).values([
    { id: 'half-coupon', tenantId: 'workspace', code: 'HALF', kind: 'percent', value: 50, scope: { kind: 'all' }, appliesTo: 'one_time', createdAt: now },
    { id: 'free-coupon', tenantId: 'workspace', code: 'FREE', kind: 'percent', value: 100, scope: { kind: 'all' }, appliesTo: 'one_time', createdAt: now },
  ]);
  await database.db.insert(orders).values([
    order('absent'), order('skipped'), order('issued'), order('delivered'), order('failed-invoice'), order('foreign-invoice'),
    order('refunded', { status: 'refunded' }), order('partial', { status: 'partially_refunded' }), order('pending', { status: 'pending' }), order('failed', { status: 'failed' }),
    order('nip', { billing: { nip: '5555555555', companyName: 'Company', address: 'Main Street 1', postalCode: '00-001', city: 'Warsaw', country: 'PL' } }),
    order('consumer-billing', { billing: { nip: null, companyName: 'Buyer', address: 'Main Street 1', postalCode: '00-001', city: 'Warsaw', country: 'PL' } }),
    order('other', { tenantId: 'other', memberId: 'other-member', productId: 'other-product' }), order('test-mode', { mode: 'test' }),
    order('before', { createdAt: '2026-08-31T21:59:59.999Z' }), order('start', { createdAt: '2026-08-31T22:00:00.000Z' }),
    order('end', { createdAt: '2026-09-30T21:59:59.999Z' }), order('after', { createdAt: '2026-09-30T22:00:00.000Z' }),
    order('winter-before', { createdAt: '2026-11-30T22:59:59.999Z' }), order('winter-start', { createdAt: '2026-11-30T23:00:00.000Z' }),
    ...excludedInvoiceStates.map((status) => order(`${status}-invoice`)),
    order('accepted-ksef'), order('uncertain-ifirma'), order('created-ifirma'), order('failed-accepted-ksef'),
    order('discounted', { amountCents: 53, couponId: 'half-coupon', discountCents: 52, createdAt: '2026-10-03T12:00:00.000Z' }),
    order('free', { amountCents: 0, couponId: 'free-coupon', discountCents: 105, createdAt: '2026-10-03T12:00:00.000Z' }),
    order('subscription', { kind: 'recurring', productId: 'inherited-product', lines: [], createdAt: '2026-10-02T12:00:00.000Z' }),
    order('inherited-vat', { lines: [{ ...line, vatRate: null }], createdAt: '2026-10-02T12:00:00.000Z' }),
    order('historical', { productId: 'inherited-product', lines: [], createdAt: '2026-10-02T12:00:00.000Z' }),
    order('rated-subscription', { kind: 'recurring', lines: [], createdAt: '2026-10-04T12:00:00.000Z' }),
  ]);
  await database.db.insert(invoices).values([
    { id: 'issued-invoice', tenantId: 'workspace', orderId: 'issued', status: 'issued' as const },
    { id: 'delivered-invoice', tenantId: 'workspace', orderId: 'delivered', status: 'delivered' as const },
    { id: 'failed-invoice', tenantId: 'workspace', orderId: 'failed-invoice', status: 'failed' as const },
    { id: 'older-failure', tenantId: 'workspace', orderId: 'issued', status: 'failed' as const },
    { id: 'foreign-invoice', tenantId: 'other', orderId: 'foreign-invoice', status: 'issued' as const },
  ].map((invoice) => ({ ...invoice, provider: 'ifirma', createdAt: now })));
  await database.db.insert(invoices).values([
    ...excludedInvoiceStates.map((status) => ({ id: `${status}-invoice`, tenantId: 'workspace', orderId: `${status}-invoice`, status, provider: 'ksef', createdAt: now })),
    { id: 'accepted-ksef', tenantId: 'workspace', orderId: 'accepted-ksef', status: 'processing', provider: 'ksef', ksef: acceptedKsef, createdAt: now },
    { id: 'uncertain-ifirma', tenantId: 'workspace', orderId: 'uncertain-ifirma', status: 'failed', provider: 'ifirma', error: 'provider_create_uncertain', createdAt: now },
    { id: 'created-ifirma', tenantId: 'workspace', orderId: 'created-ifirma', status: 'failed', provider: 'ifirma', providerInvoiceId: 'remote-invoice', createdAt: now },
    { id: 'failed-accepted-ksef', tenantId: 'workspace', orderId: 'failed-accepted-ksef', status: 'failed', provider: 'ksef', ksef: acceptedKsef, createdAt: now },
  ]);
  await database.db.insert(invoiceEvents).values({ id: 'skipped-event', tenantId: 'workspace', orderId: 'skipped', invoiceId: null, type: 'skipped', meta: {}, occurredAt: now });
});

afterAll(async () => { await database?.close(); });

const summarize = (from = '2026-09-01', to = '2026-09-30', actor = identity) => summarizeUninvoicedConsumerSales({ identity: actor }, { from, to }, { consumerSales: createConsumerSalesRepository(database.db) });

describe('consumer sales selection through the use case and local database', () => {
  it('includes absent, skipped and failed invoices and billing without a NIP', async () => {
    expect(await summarize()).toMatchObject({ ok: true, value: { orderIds: ['start', 'absent', 'consumer-billing', 'failed-invoice', 'foreign-invoice', 'skipped', 'end'], totals: { orderCount: 7, lineCount: 7, netCents: 700, vatCents: 35, grossCents: 735 } } });
  });
  it.each(['refunded', 'partial', 'issued', 'delivered', 'nip', 'other', 'before', 'after', 'pending', 'failed', 'test-mode'])('excludes %s', async (id) => {
    const result = await summarize();
    if (!result.ok) throw new Error('Summary failed');
    expect(result.value.orderIds).not.toContain(id);
  });
  it('excludes in-flight, accepted and ambiguous invoices before UPO or delivery', async () => {
    const result = await summarize();
    if (!result.ok) throw new Error('Summary failed');
    for (const id of [...excludedInvoiceStates.map((status) => `${status}-invoice`), 'accepted-ksef', 'uncertain-ifirma', 'created-ifirma', 'failed-accepted-ksef']) expect(result.value.orderIds).not.toContain(id);
  });
  it('reconciles discounted and fully discounted orders with their paid amounts', async () => {
    expect(await summarize('2026-10-03', '2026-10-03')).toMatchObject({ ok: true, value: { orderIds: ['discounted', 'free'], totals: { orderCount: 2, lineCount: 2, netCents: 50, vatCents: 3, grossCents: 53 } } });
  });
  it('reports unresolved inherited VAT in checkout, subscription and backfill-shaped lines', async () => {
    const stored = await createConsumerSalesRepository(database.db).listUninvoicedConsumers('workspace', { from: '2026-10-02', to: '2026-10-02' });
    expect(stored.filter((item) => item.id !== 'inherited-vat').map((item) => item.lines)).toEqual([
      [expect.objectContaining({ vatRate: null, grossCents: 105 })],
      [expect.objectContaining({ vatRate: null, grossCents: 105 })],
    ]);
    expect(await summarize('2026-10-02', '2026-10-02')).toMatchObject({ ok: false, error: { code: 'validation', details: { orderIds: ['historical', 'inherited-vat', 'subscription'] } } });
  });
  it('summarizes subscription lines captured by the database trigger when product VAT is explicit', async () => {
    expect(await summarize('2026-10-04', '2026-10-04')).toMatchObject({ ok: true, value: { orderIds: ['rated-subscription'], totals: { orderCount: 1, lineCount: 1, netCents: 100, vatCents: 5, grossCents: 105 } } });
  });
  it('isolates the workspace even for invoice joins', async () => {
    expect(await summarize('2026-09-01', '2026-09-30', { ...identity, tenantId: 'other' })).toMatchObject({ ok: true, value: { orderIds: ['other'] } });
  });
  it('includes both calendar endpoints at summer midnight and uses winter offset', async () => {
    const result = await summarize();
    if (!result.ok) throw new Error('Summary failed');
    expect(result.value.orders).toContainEqual(expect.objectContaining({ id: 'start', date: '2026-09-01' }));
    expect(result.value.orders).toContainEqual(expect.objectContaining({ id: 'end', date: '2026-09-30' }));
    expect(await summarize('2026-12-01', '2026-12-01')).toMatchObject({ ok: true, value: { orderIds: ['winter-start'] } });
  });
  it('changes the past-period summary when an invoice is issued later', async () => {
    await database.db.insert(invoices).values({ id: 'later-invoice', tenantId: 'workspace', orderId: 'absent', status: 'issued', provider: 'ifirma', createdAt: '2026-10-09T12:00:00.000Z' });
    const result = await summarize();
    if (!result.ok) throw new Error('Summary failed');
    expect(result.value.orderIds).not.toContain('absent');
  });
});
