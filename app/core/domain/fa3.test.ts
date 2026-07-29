import { describe, expect, it } from 'vitest';

import { renderFa3Invoice, validateFa3Structure } from './fa3.js';

const input = {
  invoiceNumber: 'FV/2026/000001',
  issueDate: '2026-07-27',
  generatedAt: '2026-07-27T10:00:00Z',
  seller: {
    nip: '5555555555',
    name: 'Together sp. z o.o.',
    addressLine: 'Prosta 1, 00-001 Warszawa',
  },
  buyer: {
    nip: '1111111111',
    name: 'Buyer sp. z o.o.',
    addressLine: 'Testowa 2, 00-002 Warszawa',
  },
  productName: 'Kurs & konsultacje',
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
  '<AdresL1>Prosta 1, 00-001 Warszawa</AdresL1></Adres></Podmiot1>' +
  '<Podmiot2><DaneIdentyfikacyjne><NIP>1111111111</NIP><Nazwa>Buyer sp. z o.o.</Nazwa>' +
  '</DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju>' +
  '<AdresL1>Testowa 2, 00-002 Warszawa</AdresL1></Adres><JST>2</JST><GV>2</GV></Podmiot2>' +
  '<Fa><KodWaluty>PLN</KodWaluty><P_1>2026-07-27</P_1><P_2>FV/2026/000001</P_2>' +
  '<P_13_7>123.45</P_13_7><P_15>123.45</P_15><Adnotacje><P_16>2</P_16><P_17>2</P_17>' +
  '<P_18>2</P_18><P_18A>2</P_18A><Zwolnienie><P_19>1</P_19>' +
  '<P_19A>art. 113 ust. 1 ustawy o podatku od towarów i usług</P_19A></Zwolnienie>' +
  '<NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu><P_23>2</P_23>' +
  '<PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy></Adnotacje><RodzajFaktury>VAT</RodzajFaktury>' +
  '<FaWiersz><NrWierszaFa>1</NrWierszaFa>' +
  '<P_7>Kurs &amp; konsultacje (rabat kuponowy: 20.00 PLN)</P_7>' +
  '<P_8A>szt.</P_8A><P_8B>1</P_8B><P_9A>123.45</P_9A><P_11>123.45</P_11>' +
  '<P_12>zw</P_12></FaWiersz></Fa></Faktura>\n';

describe('FA(3) renderer', () => {
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
    expect(first).toContain('<P_7>Kurs &amp; konsultacje (rabat kuponowy: 20.00 PLN)</P_7>');
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
      vat: { kind: 'exempt', basisKind: 'other', basis: '§ 1 & < " rozporządzenia' },
    });

    expect(xml).toContain('<P_19C>§ 1 &amp; &lt; &quot; rozporządzenia</P_19C>');
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
        name: 'Jan Kowalski',
        addressLine: 'Testowa 3, 00-003 Warszawa',
      },
      discountCents: 0,
    });

    expect(xml).toContain('<BrakID>1</BrakID>');
    expect(xml).toContain('<Nazwa>Jan Kowalski</Nazwa>');
    expect(xml).toContain('<AdresL1>Testowa 3, 00-003 Warszawa</AdresL1>');
    expect(xml).not.toContain('<NIP>1111111111</NIP>');
    expect(validateFa3Structure(xml)).toEqual({ ok: true, errors: [] });
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
