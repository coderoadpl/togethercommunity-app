import { describe, expect, it } from 'vitest';

import { invoicePositionQuantity, renderFa3Invoice, validateFa3Structure } from './fa3.js';
import { lineInvoicePositions } from './invoice-positions.js';
import { splitProductGross } from './product-vat.js';
import type { InvoiceVatTreatment } from './tenant.js';

const input = {
  invoiceNumber: 'FV/2026/000001',
  issueDate: '2026-07-27',
  generatedAt: '2026-07-27T10:00:00Z',
  seller: {
    nip: '5555555555',
    name: 'Together sp. z o.o.',
    addressLine: '1 Simple St, 00-001 Warsaw',
  },
  buyer: {
    nip: '1111111111',
    name: 'Buyer sp. z o.o.',
    addressLine: '2 Test St, 00-002 Warsaw',
  },
  productName: 'Course & consulting',
  grossAmountCents: 7900,
  discountCents: 2000,
  vat: { kind: 'rate' as const, percent: 23 as const },
};

const EXEMPT_FA3_FIXTURE =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">' +
  '<Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza>' +
  '<WariantFormularza>3</WariantFormularza><DataWytworzeniaFa>2026-07-27T10:00:00Z</DataWytworzeniaFa>' +
  '<SystemInfo>Together</SystemInfo></Naglowek>' +
  '<Podmiot1><DaneIdentyfikacyjne><NIP>5555555555</NIP><Nazwa>Together sp. z o.o.</Nazwa>' +
  '</DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju>' +
  '<AdresL1>1 Simple St, 00-001 Warsaw</AdresL1></Adres></Podmiot1>' +
  '<Podmiot2><DaneIdentyfikacyjne><NIP>1111111111</NIP><Nazwa>Buyer sp. z o.o.</Nazwa>' +
  '</DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju>' +
  '<AdresL1>2 Test St, 00-002 Warsaw</AdresL1></Adres><JST>2</JST><GV>2</GV></Podmiot2>' +
  '<Fa><KodWaluty>PLN</KodWaluty><P_1>2026-07-27</P_1><P_2>FV/2026/000001</P_2>' +
  '<P_13_7>123.45</P_13_7><P_15>123.45</P_15><Adnotacje><P_16>2</P_16><P_17>2</P_17>' +
  '<P_18>2</P_18><P_18A>2</P_18A><Zwolnienie><P_19>1</P_19>' +
  '<P_19A>art. 113 ust. 1 ustawy o podatku od towarów i usług</P_19A></Zwolnienie>' +
  '<NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu><P_23>2</P_23>' +
  '<PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy></Adnotacje><RodzajFaktury>VAT</RodzajFaktury>' +
  '<FaWiersz><NrWierszaFa>1</NrWierszaFa>' +
  '<P_7>Course &amp; consulting (rabat kuponowy: 20.00 PLN)</P_7>' +
  '<P_8A>szt.</P_8A><P_8B>1</P_8B><P_9A>123.45</P_9A><P_11>123.45</P_11>' +
  '<P_12>zw</P_12></FaWiersz></Fa></Faktura>\n';

describe('FA(3) renderer', () => {
  it('renders and validates mixed rates with exemption in line order', () => {
    const xml = renderFa3Invoice({ ...input, grossAmountCents: 27800, discountCents: 0, positions: [
      { name: 'Printed material', grossCents: 10500, netCents: 10000, vatCents: 500, vat: { kind: 'rate', percent: 5 } },
      { name: 'Download', grossCents: 12300, netCents: 10000, vatCents: 2300, vat: { kind: 'rate', percent: 23 } },
      { name: 'Workshop', grossCents: 5000, netCents: 5000, vatCents: 0, vat: { kind: 'exempt', basisKind: 'other', basis: 'Section 1' } },
    ] });
    expect(xml).toContain('<P_13_1>100.00</P_13_1><P_14_1>23.00</P_14_1><P_13_3>100.00</P_13_3><P_14_3>5.00</P_14_3><P_13_7>50.00</P_13_7>');
    expect(xml).toContain('<P_15>278.00</P_15>');
    expect(xml.indexOf('<P_7>Printed material')).toBeLessThan(xml.indexOf('<P_7>Download'));
    expect(xml).toContain('<NrWierszaFa>3</NrWierszaFa>');
    expect(validateFa3Structure(xml)).toEqual({ ok: true, errors: [] });
  });

  it('renders the quantity, unit net and position net of a multi-unit position', () => {
    const xml = renderFa3Invoice({ ...input, grossAmountCents: 9000, discountCents: 0, positions: [
      { name: 'Poster', quantity: 3, grossCents: 9000, netCents: 7317, vatCents: 1683, vat: { kind: 'rate', percent: 23 } },
    ] });
    expect(xml).toContain('<P_7>Poster</P_7><P_8A>szt.</P_8A><P_8B>3</P_8B><P_9A>24.39</P_9A><P_11>73.17</P_11><P_12>23</P_12>');
    expect(xml).toContain('<P_13_1>73.17</P_13_1><P_14_1>16.83</P_14_1>');
    expect(validateFa3Structure(xml)).toEqual({ ok: true, errors: [] });
  });

  it('carries the unit net with the decimals that make quantity times unit price round to the position net', () => {
    const render = (quantity: number, grossCents: number): string => renderFa3Invoice({ ...input, grossAmountCents: grossCents, discountCents: 0,
      positions: lineInvoicePositions({ name: 'Poster', quantity, grossCents, vat: { kind: 'rate', percent: 23 } }) });

    expect(render(3, 300)).toContain('<P_8B>3</P_8B><P_9A>0.81333333</P_9A><P_11>2.44</P_11>');
    expect(render(99, 9999)).toContain('<P_8B>99</P_8B><P_9A>0.82111111</P_9A><P_11>81.29</P_11>');
    expect(render(1, 7900)).toContain('<P_8B>1</P_8B><P_9A>64.23</P_9A><P_11>64.23</P_11>');
  });

  it('keeps every multi-unit position arithmetically consistent and the totals equal to the line', () => {
    const treatments: InvoiceVatTreatment[] = [
      { kind: 'rate', percent: 5 },
      { kind: 'rate', percent: 8 },
      { kind: 'rate', percent: 23 },
      { kind: 'exempt', basisKind: 'art_113_1', basis: 'art. 113 ust. 1' },
    ];
    const grosses = [0, 1, 2, 99, 100, 101, 300, 4900, 7999, 9999, 10001, 12345, 99999, 123457, 1999999];
    const cents = (amount: string): bigint => BigInt(amount.replace('.', ''));
    const unitSubunits = (amount: string): bigint => {
      const [whole = '', fraction = ''] = amount.split('.');
      return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0'));
    };
    for (const vat of treatments) {
      const rate = vat.kind === 'exempt' ? 'exempt' : vat.percent;
      for (let quantity = 1; quantity <= 99; quantity += 1) {
        for (const grossCents of grosses) {
          const label = `${String(grossCents)} x ${String(quantity)} at ${String(rate)}`;
          const positions = lineInvoicePositions({ name: 'Item', quantity, grossCents, vat });
          const xml = renderFa3Invoice({ ...input, grossAmountCents: grossCents, discountCents: 0, vat, positions });
          const rows = [...xml.matchAll(/<P_8B>(\d+)<\/P_8B><P_9A>([^<]+)<\/P_9A><P_11>([^<]+)<\/P_11>/gu)];
          expect(rows, label).toHaveLength(positions.length);
          rows.forEach(([, rowQuantity = '', unit = '', value = ''], index) => {
            expect(unit, label).toMatch(/^([1-9]\d{0,13}|0)\.\d{2,8}$/u);
            expect(value, label).toMatch(/^([1-9]\d{0,15}|0)\.\d{2}$/u);
            expect(Number(rowQuantity), label).toBe(invoicePositionQuantity(positions[index] ?? { quantity: 0 }));
            expect((BigInt(rowQuantity) * unitSubunits(unit) + 500_000n) / 1_000_000n, label).toBe(cents(value));
            expect(cents(value), label).toBe(BigInt(positions[index]?.netCents ?? -1));
          });
          const line = splitProductGross(grossCents, rate);
          const net = rows.reduce((total, [, , , value = '']) => total + cents(value), 0n);
          expect(net, label).toBe(BigInt(line.netCents));
          const suffix = vat.kind === 'exempt' ? '7' : { 5: '3', 8: '2', 23: '1' }[vat.percent];
          const summary = vat.kind === 'exempt'
            ? `<P_13_7>${(line.netCents / 100).toFixed(2)}</P_13_7>`
            : `<P_13_${suffix}>${(line.netCents / 100).toFixed(2)}</P_13_${suffix}><P_14_${suffix}>${(line.vatCents / 100).toFixed(2)}</P_14_${suffix}>`;
          expect(xml, label).toContain(summary);
          expect(xml, label).toContain(`<P_15>${(line.grossCents / 100).toFixed(2)}</P_15>`);
        }
      }
    }
  });

  it('is deterministic and emits the official FA(3) identity in schema order', () => {
    const first = renderFa3Invoice(input);
    const second = renderFa3Invoice(input);

    expect(first).toBe(second);
    expect(validateFa3Structure(first)).toEqual({ ok: true, errors: [] });
    expect(first).toContain('xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"');
    expect(first).toContain('kodSystemowy="FA (3)" wersjaSchemy="1-0E"');
    expect(first.indexOf('<P_13_1>')).toBeLessThan(first.indexOf('<P_14_1>'));
    expect(first.indexOf('<P_14_1>')).toBeLessThan(first.indexOf('<P_15>'));
    expect(first).toContain('<P_15>79.00</P_15>');
    expect(first).toContain('<P_7>Course &amp; consulting (rabat kuponowy: 20.00 PLN)</P_7>');
  });

  it.each([
    { vatRatePercent: 5 as const, net: '75.24', vat: '3.76', suffix: '3' },
    { vatRatePercent: 8 as const, net: '73.15', vat: '5.85', suffix: '2' },
    { vatRatePercent: 23 as const, net: '64.23', vat: '14.77', suffix: '1' },
  ])('renders the $vatRatePercent percent summary', ({ vatRatePercent, net, vat, suffix }) => {
    const xml = renderFa3Invoice({ ...input, vat: { kind: 'rate', percent: vatRatePercent } });

    expect(xml).toContain(`<P_13_${suffix}>${net}</P_13_${suffix}>`);
    expect(xml).toContain(`<P_14_${suffix}>${vat}</P_14_${suffix}>`);
    expect(xml).toContain(`<P_12>${String(vatRatePercent)}</P_12>`);
  });

  it('renders an exempt invoice without VAT amounts or rounding', () => {
    const xml = renderFa3Invoice({
      ...input,
      grossAmountCents: 12345,
      vat: {
        kind: 'exempt',
        basisKind: 'art_113_1',
        basis: '  art. 113 ust. 1   ustawy o podatku od towarów i usług  ',
      },
    });

    expect(xml).toBe(EXEMPT_FA3_FIXTURE);
    expect(xml).toContain('<P_13_7>123.45</P_13_7><P_15>123.45</P_15>');
    expect(xml).toContain('<P_19>1</P_19><P_19A>art. 113 ust. 1 ustawy o podatku od towarów i usług</P_19A>');
    expect(xml).toContain('<P_9A>123.45</P_9A><P_11>123.45</P_11><P_12>zw</P_12>');
    expect(xml).not.toContain('<P_14_');
    expect(xml).not.toContain('<P_19N>');
    expect(validateFa3Structure(xml)).toEqual({ ok: true, errors: [] });
  });

  it('uses P_19C for another legal basis and escapes its text', () => {
    const xml = renderFa3Invoice({
      ...input,
      vat: { kind: 'exempt', basisKind: 'other', basis: 'Section 1 & < " of the regulation' },
    });

    expect(xml).toContain('<P_19C>Section 1 &amp; &lt; &quot; of the regulation</P_19C>');
  });

  it('caps a normalized exemption basis at 256 characters', () => {
    const xml = renderFa3Invoice({
      ...input,
      vat: { kind: 'exempt', basisKind: 'other', basis: 'A'.repeat(300) },
    });

    expect(xml.match(/<P_19C>(.*?)<\/P_19C>/u)?.[1]).toHaveLength(256);
  });

  it.each([
    ['exemption-basis', (xml: string) => xml.replace(/<P_19A>.*?<\/P_19A>/u, '')],
    ['exemption-basis-choice', (xml: string) => xml.replace('</Zwolnienie>', '<P_19C>x</P_19C></Zwolnienie>')],
    ['exemption-both-branches', (xml: string) => xml.replace('</Zwolnienie>', '<P_19N>1</P_19N></Zwolnienie>')],
    ['exemption-vat-amount', (xml: string) => xml.replace('<P_15>', '<P_14_1>0.00</P_14_1><P_15>')],
    ['exemption-summary', (xml: string) => xml.replace(/<P_13_7>.*?<\/P_13_7>/u, '')],
    ['exemption-total-mismatch', (xml: string) => xml.replace('<P_13_7>79.00</P_13_7>', '<P_13_7>78.00</P_13_7>')],
    ['exemption-line-rate', (xml: string) => xml.replace('<P_12>zw</P_12>', '<P_12>23</P_12>')],
  ])('rejects %s', (error, mutate) => {
    const xml = renderFa3Invoice({
      ...input,
      vat: { kind: 'exempt', basisKind: 'art_113_1', basis: 'art. 113 ust. 1' },
    });
    expect(validateFa3Structure(mutate(xml)).errors).toContain(error);
  });

  it('rejects a zw line without the exemption branch', () => {
    const xml = renderFa3Invoice(input).replace('<P_12>23</P_12>', '<P_12>zw</P_12>');

    expect(validateFa3Structure(xml).errors).toContain('exemption-line-rate');
  });

  it('renders a B2C buyer without inventing a tax identifier', () => {
    const xml = renderFa3Invoice({
      ...input,
      buyer: {
        nip: null,
        name: 'John Smith',
        addressLine: '3 Test St, 00-003 Warsaw',
      },
      discountCents: 0,
    });

    expect(xml).toContain('<BrakID>1</BrakID>');
    expect(xml).toContain('<Nazwa>John Smith</Nazwa>');
    expect(xml).toContain('<AdresL1>3 Test St, 00-003 Warsaw</AdresL1>');
    expect(xml).not.toContain('<NIP>1111111111</NIP>');
    expect(validateFa3Structure(xml)).toEqual({ ok: true, errors: [] });
  });

  it('preserves a consumer country and partial address without requiring a name or NIP', () => {
    const xml = renderFa3Invoice({ ...input, buyer: { nip: null, name: '', addressLine: '10115', country: 'DE' } });

    expect(xml).toContain('<BrakID>1</BrakID>');
    expect(xml).toContain('<Adres><KodKraju>DE</KodKraju><AdresL1>10115</AdresL1></Adres>');
    expect(xml).not.toContain('<Nazwa></Nazwa>');
  });

  it('omits an uncollected consumer address', () => {
    const xml = renderFa3Invoice({ ...input, buyer: { nip: null, name: 'John Smith', addressLine: '' } });

    expect(xml).toContain('<Podmiot2><DaneIdentyfikacyjne><BrakID>1</BrakID><Nazwa>John Smith</Nazwa></DaneIdentyfikacyjne><JST>');
  });

  it('uses the anonymous buyer only when no billing snapshot exists', () => {
    const xml = renderFa3Invoice({ ...input, buyer: null, discountCents: 0 });

    expect(xml).toContain('<BrakID>1</BrakID>');
    expect(xml).toContain('<Nazwa>Klient detaliczny</Nazwa>');
  });

  it('rejects malformed or non-canonical structural variants before submission', () => {
    const xml = renderFa3Invoice(input);

    expect(validateFa3Structure(xml.replace('<RodzajFaktury>VAT</RodzajFaktury>', ''))).toEqual({
      ok: false,
      errors: ['RodzajFaktury'],
    });
    expect(validateFa3Structure(`\uFEFF${xml}`).errors).toContain('utf8-bom');
  });
});
