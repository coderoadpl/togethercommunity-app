import { describe, expect, it } from 'vitest';

import { ok, tenantSettingsSchema, type Invoice, type InvoiceEvent, type OrderListItem } from '#core/domain/index.js';
import { requestInvoice, type InvoiceDeps } from '#core/server/index.js';
import { inMemoryChangeSettings } from '#core/server/testing/tenant-settings-fake.js';

import { createIfirmaInvoicing } from './ifirma.js';

const now = '2026-11-15T10:00:00.000Z';

const billing = { nip: '5260250274', companyName: 'Buyer Company', address: 'Main 1', postalCode: '00-001', city: 'Warsaw', country: 'PL' };

const orderBase = {
  mode: 'live', tenantId: 'tenant-a', memberId: 'member-1', kind: 'one_time', status: 'paid', currency: 'PLN', provider: 'stripe',
  couponId: null, discountCents: 0, billing, attribution: null, paidAt: now, createdAt: now,
  memberEmail: 'buyer@example.com', memberName: 'Buyer', couponCode: null,
} as const;

const courseOrder: OrderListItem = {
  ...orderBase, id: 'order-course', productId: 'course-1', priceId: null, amountCents: 4900, productTitle: 'Course One',
  providerObjectIds: { checkoutSession: 'cs_live_golden1', paymentIntent: 'pi_golden1' }, salesLinkId: null,
  lines: [{ productId: 'course-1', name: 'Course One', productType: 'course', grossCents: 4900, netCents: 3984, vatCents: 916, vatRate: 23, vatExemptionBasis: null, vatExemptionBasisKind: null, issuedCount: null }],
};

const printedOrder: OrderListItem = {
  ...orderBase, id: 'order-printed', productId: 'printed-1', priceId: 'price-printed-1', amountCents: 4099, productTitle: 'Printed book',
  providerObjectIds: { checkoutSession: 'cs_live_golden1', paymentIntent: 'pi_golden1' }, salesLinkId: null,
  lines: [
    { productId: 'printed-1', name: 'Printed book', productType: 'physical', grossCents: 2100, netCents: 2000, vatCents: 100, vatRate: 5, vatExemptionBasis: null, vatExemptionBasisKind: null, issuedCount: 0 },
    { productId: 'shipping:courier', name: 'Courier', productType: 'shipping', grossCents: 1999, netCents: 1851, vatCents: 148, vatRate: 8, vatExemptionBasis: null, vatExemptionBasisKind: null, issuedCount: null },
  ],
};

const bundleOrder: OrderListItem = {
  ...orderBase, id: 'order-bundle', productId: 'course-1', priceId: null, amountCents: 8400, productTitle: 'Course One',
  providerObjectIds: { checkoutSession: 'cs_live_golden1', paymentIntent: 'pi_golden1' }, salesLinkId: 'link-1',
  lines: [
    { productId: 'course-1', name: 'Course One', productType: 'course', priceId: 'price-course-1', grossCents: 4900, netCents: 3984, vatCents: 916, vatRate: 23, vatExemptionBasis: null, vatExemptionBasisKind: null, issuedCount: null },
    { productId: 'poster-1', name: 'Poster', productType: 'physical', priceId: 'price-poster-1', grossCents: 3500, netCents: 3241, vatCents: 259, vatRate: 8, vatExemptionBasis: null, vatExemptionBasisKind: null, issuedCount: 0 },
  ],
};

const ctx = {
  identity: {
    userId: 'user-1', email: 'owner@example.com', name: 'Owner', emailVerified: true, tenantAccess: 'staff' as const,
    tenantId: 'tenant-a', tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner' as const, memberId: null, image: null,
    memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
  },
};

const invoiceHarness = (provider: 'ifirma' | 'ksef', order: OrderListItem) => {
  const invoices: Invoice[] = [];
  const events: InvoiceEvent[] = [];
  const ifirmaBodies: string[] = [];
  const xml: string[] = [];
  let ids = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.method === 'POST') ifirmaBodies.push(await request.text());
    return new Response(JSON.stringify({ response: { Kod: 500, Informacja: 'Golden capture only' } }), { status: 500, headers: { 'content-type': 'application/json' } });
  };
  const settings = tenantSettingsSchema.parse({
    name: 'Acme', billingPortalUrl: null, bunnyStreamLibraryId: null, invoicingProvider: provider, invoiceVatMode: 'rate', invoiceVatRatePercent: 23,
    invoiceSellerName: 'Acme sp. z o.o.', invoiceSellerAddress: 'Prosta 1, 00-001 Warszawa', ksefSubmissionMode: 'automatic',
  });
  const deps: InvoiceDeps = {
    invoices: {
      findById: async (_tenantId, id) => invoices.find((invoice) => invoice.id === id) ?? null,
      findCurrentByOrder: async (_tenantId, orderId) => invoices.find((invoice) => invoice.orderId === orderId) ?? null,
      findLatestRequestedEvent: async () => null,
      create: async (_tenantId, invoice, event) => { invoices.push(invoice); events.push(event); return true; },
      claimRetry: async () => false,
      update: async (_tenantId, invoice, event) => {
        const index = invoices.findIndex((item) => item.id === invoice.id);
        invoices[index] = invoice;
        events.push(event);
        return invoice;
      },
      appendEvent: async (_tenantId, event) => { events.push(event); },
      createFrozenKsef: async (_tenantId, invoice, event, artifact) => {
        invoices.push(invoice);
        events.push(event);
        xml.push(artifact.content);
        return true;
      },
      checkpointKsef: async (_tenantId, invoice) => invoice,
    },
    invoicing: createIfirmaInvoicing(fetcher, () => '2026-11-15'),
    orderDetails: { findById: async () => order },
    tenants: {
      findById: async () => null, findBySlug: async () => null, findSole: async () => null, hasAny: async () => true,
      findSettings: async () => settings, changeSettings: inMemoryChangeSettings(() => settings),
      createTenantWithOwnerGrant: async () => { throw new Error('unused'); },
    },
    tenantSecrets: {
      listByTenant: async () => [],
      findByKey: async (_tenantId, key) => ({
        id: key, tenantId: 'tenant-a', key, ciphertext: key === 'ifirma.invoiceApiKey' ? 'EAB0D8ACF3308F3B' : 'owner@example.com',
        iv: 'iv', authTag: 'tag', maskedPreview: '••••', updatedAt: now,
      }),
      upsert: async (_tenantId, value) => value,
      upsertMany: async (_tenantId, values) => [...values],
      delete: async () => false,
    },
    secretCrypto: { encrypt: (plaintext) => ({ ciphertext: plaintext, iv: 'iv', authTag: 'tag' }), decrypt: (stored) => ok(stored.ciphertext) },
    ids: { nextId: () => `invoice-id-${String(++ids)}` },
    clock: { nowIso: () => now },
    ksef: {
      environment: 'test',
      credentials: { resolve: async (_tenantId, mode = 'live') => ok({ tenantId: 'tenant-a', credentialSlot: mode, token: 'ksef-token', contextNip: '5555555555' }) },
      numbers: { allocate: async (_tenantId, input) => ok({ p2: `FV/${String(input.year)}/000001`, sequence: 1 }) },
      artifacts: { findByKey: async () => null, store: async () => true },
      hash: { sha256: () => 'a'.repeat(64) },
      validator: { validate: async () => ok(undefined) },
      client: {
        validateCredentials: async () => ok({ diagnostic: 'unused' }),
        openSession: async () => ok({ sessionReference: 'session-1' }),
        submitInvoice: async () => ok({ invoiceReference: 'invoice-reference-1' }),
        listSessionInvoices: async () => ok([]),
        getInvoiceStatus: async () => ok({ code: 150, description: 'Processing', details: [], extensions: {}, ksefNumber: null, acquisitionAt: null, invoicingAt: null, permanentStorageAt: null }),
        downloadUpo: async () => ok('<upo/>'),
        verifyDuplicateOriginal: async () => ok(false),
        closeSession: async () => ok(undefined),
      },
    },
  };
  deps.invoices.withKsefInvoiceLock = async (_tenantId, _orderId, work) => {
    if (deps.ksef === undefined) throw new Error('KSeF test dependencies missing');
    return work({ invoices: deps.invoices, numbers: deps.ksef.numbers });
  };
  return { deps, events, ifirmaBodies, xml };
};

const ifirmaUnavailable = {
  ok: false,
  error: { code: 'integration_unavailable', message: 'iFirma could not issue the invoice because its API reported a technical failure. Retry later. iFirma says: Golden capture only' },
};

describe('iFirma payload of legacy orders', () => {
  it('sends one position from the order total for a one-line order', async () => {
    const h = invoiceHarness('ifirma', courseOrder);
    expect(await requestInvoice(ctx, courseOrder.id, h.deps)).toStrictEqual(ifirmaUnavailable);
    expect(h.ifirmaBodies).toStrictEqual([
      '{"Zaplacono":49,"ZaplaconoNaDokumencie":49,"LiczOd":"BRT","NumerKontaBankowego":null,"DataWystawienia":"2026-11-15","DataSprzedazy":"2026-11-15","FormatDatySprzedazy":"DZN","TerminPlatnosci":null,"SposobZaplaty":"ELE","RodzajPodpisuOdbiorcy":"BWO","WidocznyNumerBdo":false,"Numer":null,"Pozycje":[{"StawkaVat":0.23,"Ilosc":1,"CenaJednostkowa":49,"NazwaPelna":"Course One","Jednostka":"szt.","PKWiU":"","TypStawkiVat":"PRC"}],"Kontrahent":{"Nazwa":"Buyer Company","Identyfikator":null,"PrefiksUE":null,"NIP":"5260250274","Ulica":"Main 1","KodPocztowy":"00-001","Kraj":"Polska","KodKraju":"PL","Miejscowosc":"Warsaw","OsobaFizyczna":false}}',
    ]);
    expect(h.events.find((event) => event.type === 'requested')?.meta).toStrictEqual({
      vat: { kind: 'rate', percent: 23 },
      positions: [{ name: 'Course One', grossCents: 4900, netCents: 3984, vatCents: 916, vat: { kind: 'rate', percent: 23 } }],
    });
  });

  it('sends one position per line for a single product with a delivery line', async () => {
    const h = invoiceHarness('ifirma', printedOrder);
    expect(await requestInvoice(ctx, printedOrder.id, h.deps)).toStrictEqual(ifirmaUnavailable);
    expect(h.ifirmaBodies).toStrictEqual([
      '{"Zaplacono":40.99,"ZaplaconoNaDokumencie":40.99,"LiczOd":"BRT","NumerKontaBankowego":null,"DataWystawienia":"2026-11-15","DataSprzedazy":"2026-11-15","FormatDatySprzedazy":"DZN","TerminPlatnosci":null,"SposobZaplaty":"ELE","RodzajPodpisuOdbiorcy":"BWO","WidocznyNumerBdo":false,"Numer":null,"Pozycje":[{"StawkaVat":0.05,"Ilosc":1,"CenaJednostkowa":21,"NazwaPelna":"Printed book","Jednostka":"szt.","PKWiU":"","TypStawkiVat":"PRC"},{"StawkaVat":0.08,"Ilosc":1,"CenaJednostkowa":19.99,"NazwaPelna":"Courier","Jednostka":"szt.","PKWiU":"","TypStawkiVat":"PRC"}],"Kontrahent":{"Nazwa":"Buyer Company","Identyfikator":null,"PrefiksUE":null,"NIP":"5260250274","Ulica":"Main 1","KodPocztowy":"00-001","Kraj":"Polska","KodKraju":"PL","Miejscowosc":"Warsaw","OsobaFizyczna":false}}',
    ]);
    expect(h.events.find((event) => event.type === 'requested')?.meta).toStrictEqual({
      vat: { kind: 'rate', percent: 5 },
      positions: [
        { name: 'Printed book', grossCents: 2100, netCents: 2000, vatCents: 100, vat: { kind: 'rate', percent: 5 } },
        { name: 'Courier', grossCents: 1999, netCents: 1851, vatCents: 148, vat: { kind: 'rate', percent: 8 } },
      ],
    });
  });

  it('sends one position per line for a multi-line sales-link order', async () => {
    const h = invoiceHarness('ifirma', bundleOrder);
    expect(await requestInvoice(ctx, bundleOrder.id, h.deps)).toStrictEqual(ifirmaUnavailable);
    expect(h.ifirmaBodies).toStrictEqual([
      '{"Zaplacono":84,"ZaplaconoNaDokumencie":84,"LiczOd":"BRT","NumerKontaBankowego":null,"DataWystawienia":"2026-11-15","DataSprzedazy":"2026-11-15","FormatDatySprzedazy":"DZN","TerminPlatnosci":null,"SposobZaplaty":"ELE","RodzajPodpisuOdbiorcy":"BWO","WidocznyNumerBdo":false,"Numer":null,"Pozycje":[{"StawkaVat":0.23,"Ilosc":1,"CenaJednostkowa":49,"NazwaPelna":"Course One","Jednostka":"szt.","PKWiU":"","TypStawkiVat":"PRC"},{"StawkaVat":0.08,"Ilosc":1,"CenaJednostkowa":35,"NazwaPelna":"Poster","Jednostka":"szt.","PKWiU":"","TypStawkiVat":"PRC"}],"Kontrahent":{"Nazwa":"Buyer Company","Identyfikator":null,"PrefiksUE":null,"NIP":"5260250274","Ulica":"Main 1","KodPocztowy":"00-001","Kraj":"Polska","KodKraju":"PL","Miejscowosc":"Warsaw","OsobaFizyczna":false}}',
    ]);
    expect(h.events.find((event) => event.type === 'requested')?.meta).toStrictEqual({
      vat: { kind: 'rate', percent: 23 },
      positions: [
        { name: 'Course One', grossCents: 4900, netCents: 3984, vatCents: 916, vat: { kind: 'rate', percent: 23 } },
        { name: 'Poster', grossCents: 3500, netCents: 3241, vatCents: 259, vat: { kind: 'rate', percent: 8 } },
      ],
    });
  });
});

describe('FA(3) document of legacy orders', () => {
  it('renders one row from the order total for a one-line order', async () => {
    const h = invoiceHarness('ksef', courseOrder);
    expect((await requestInvoice(ctx, courseOrder.id, h.deps)).ok).toBe(true);
    expect(h.xml).toStrictEqual([
      '<?xml version="1.0" encoding="UTF-8"?>\n<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"><Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza><WariantFormularza>3</WariantFormularza><DataWytworzeniaFa>2026-11-15T10:00:00.000Z</DataWytworzeniaFa><SystemInfo>Together</SystemInfo></Naglowek><Podmiot1><DaneIdentyfikacyjne><NIP>5555555555</NIP><Nazwa>Acme sp. z o.o.</Nazwa></DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju><AdresL1>Prosta 1, 00-001 Warszawa</AdresL1></Adres></Podmiot1><Podmiot2><DaneIdentyfikacyjne><NIP>5260250274</NIP><Nazwa>Buyer Company</Nazwa></DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju><AdresL1>Main 1, 00-001 Warsaw</AdresL1></Adres><JST>2</JST><GV>2</GV></Podmiot2><Fa><KodWaluty>PLN</KodWaluty><P_1>2026-11-15</P_1><P_2>FV/2026/000001</P_2><P_13_1>39.84</P_13_1><P_14_1>9.16</P_14_1><P_15>49.00</P_15><Adnotacje><P_16>2</P_16><P_17>2</P_17><P_18>2</P_18><P_18A>2</P_18A><Zwolnienie><P_19N>1</P_19N></Zwolnienie><NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu><P_23>2</P_23><PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy></Adnotacje><RodzajFaktury>VAT</RodzajFaktury><FaWiersz><NrWierszaFa>1</NrWierszaFa><P_7>Course One</P_7><P_8A>szt.</P_8A><P_8B>1</P_8B><P_9A>39.84</P_9A><P_11>39.84</P_11><P_12>23</P_12></FaWiersz></Fa></Faktura>\n',
    ]);
    expect(h.events.find((event) => event.type === 'frozen')?.meta).toStrictEqual({
      p2: 'FV/2026/000001',
      xmlSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      vat: { kind: 'rate', percent: 23 },
      positions: [{ name: 'Course One', grossCents: 4900, netCents: 3984, vatCents: 916, vat: { kind: 'rate', percent: 23 } }],
    });
  });

  it('renders one row per line for a single product with a delivery line', async () => {
    const h = invoiceHarness('ksef', printedOrder);
    expect((await requestInvoice(ctx, printedOrder.id, h.deps)).ok).toBe(true);
    expect(h.xml).toStrictEqual([
      '<?xml version="1.0" encoding="UTF-8"?>\n<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"><Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza><WariantFormularza>3</WariantFormularza><DataWytworzeniaFa>2026-11-15T10:00:00.000Z</DataWytworzeniaFa><SystemInfo>Together</SystemInfo></Naglowek><Podmiot1><DaneIdentyfikacyjne><NIP>5555555555</NIP><Nazwa>Acme sp. z o.o.</Nazwa></DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju><AdresL1>Prosta 1, 00-001 Warszawa</AdresL1></Adres></Podmiot1><Podmiot2><DaneIdentyfikacyjne><NIP>5260250274</NIP><Nazwa>Buyer Company</Nazwa></DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju><AdresL1>Main 1, 00-001 Warsaw</AdresL1></Adres><JST>2</JST><GV>2</GV></Podmiot2><Fa><KodWaluty>PLN</KodWaluty><P_1>2026-11-15</P_1><P_2>FV/2026/000001</P_2><P_6>2026-11-15</P_6><P_13_2>18.51</P_13_2><P_14_2>1.48</P_14_2><P_13_3>20.00</P_13_3><P_14_3>1.00</P_14_3><P_15>40.99</P_15><Adnotacje><P_16>2</P_16><P_17>2</P_17><P_18>2</P_18><P_18A>2</P_18A><Zwolnienie><P_19N>1</P_19N></Zwolnienie><NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu><P_23>2</P_23><PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy></Adnotacje><RodzajFaktury>VAT</RodzajFaktury><FaWiersz><NrWierszaFa>1</NrWierszaFa><P_7>Printed book</P_7><P_8A>szt.</P_8A><P_8B>1</P_8B><P_9A>20.00</P_9A><P_11>20.00</P_11><P_12>5</P_12></FaWiersz><FaWiersz><NrWierszaFa>2</NrWierszaFa><P_7>Courier</P_7><P_8A>szt.</P_8A><P_8B>1</P_8B><P_9A>18.51</P_9A><P_11>18.51</P_11><P_12>8</P_12></FaWiersz></Fa></Faktura>\n',
    ]);
    expect(h.events.find((event) => event.type === 'frozen')?.meta).toStrictEqual({
      p2: 'FV/2026/000001',
      xmlSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      vat: { kind: 'rate', percent: 5 },
      positions: [
        { name: 'Printed book', grossCents: 2100, netCents: 2000, vatCents: 100, vat: { kind: 'rate', percent: 5 } },
        { name: 'Courier', grossCents: 1999, netCents: 1851, vatCents: 148, vat: { kind: 'rate', percent: 8 } },
      ],
    });
  });

  it('renders one row per line for a multi-line sales-link order', async () => {
    const h = invoiceHarness('ksef', bundleOrder);
    expect((await requestInvoice(ctx, bundleOrder.id, h.deps)).ok).toBe(true);
    expect(h.xml).toStrictEqual([
      '<?xml version="1.0" encoding="UTF-8"?>\n<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"><Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza><WariantFormularza>3</WariantFormularza><DataWytworzeniaFa>2026-11-15T10:00:00.000Z</DataWytworzeniaFa><SystemInfo>Together</SystemInfo></Naglowek><Podmiot1><DaneIdentyfikacyjne><NIP>5555555555</NIP><Nazwa>Acme sp. z o.o.</Nazwa></DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju><AdresL1>Prosta 1, 00-001 Warszawa</AdresL1></Adres></Podmiot1><Podmiot2><DaneIdentyfikacyjne><NIP>5260250274</NIP><Nazwa>Buyer Company</Nazwa></DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju><AdresL1>Main 1, 00-001 Warsaw</AdresL1></Adres><JST>2</JST><GV>2</GV></Podmiot2><Fa><KodWaluty>PLN</KodWaluty><P_1>2026-11-15</P_1><P_2>FV/2026/000001</P_2><P_6>2026-11-15</P_6><P_13_1>39.84</P_13_1><P_14_1>9.16</P_14_1><P_13_2>32.41</P_13_2><P_14_2>2.59</P_14_2><P_15>84.00</P_15><Adnotacje><P_16>2</P_16><P_17>2</P_17><P_18>2</P_18><P_18A>2</P_18A><Zwolnienie><P_19N>1</P_19N></Zwolnienie><NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu><P_23>2</P_23><PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy></Adnotacje><RodzajFaktury>VAT</RodzajFaktury><FaWiersz><NrWierszaFa>1</NrWierszaFa><P_7>Course One</P_7><P_8A>szt.</P_8A><P_8B>1</P_8B><P_9A>39.84</P_9A><P_11>39.84</P_11><P_12>23</P_12></FaWiersz><FaWiersz><NrWierszaFa>2</NrWierszaFa><P_7>Poster</P_7><P_8A>szt.</P_8A><P_8B>1</P_8B><P_9A>32.41</P_9A><P_11>32.41</P_11><P_12>8</P_12></FaWiersz></Fa></Faktura>\n',
    ]);
    expect(h.events.find((event) => event.type === 'frozen')?.meta).toStrictEqual({
      p2: 'FV/2026/000001',
      xmlSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      vat: { kind: 'rate', percent: 23 },
      positions: [
        { name: 'Course One', grossCents: 4900, netCents: 3984, vatCents: 916, vat: { kind: 'rate', percent: 23 } },
        { name: 'Poster', grossCents: 3500, netCents: 3241, vatCents: 259, vat: { kind: 'rate', percent: 8 } },
      ],
    });
  });
});
