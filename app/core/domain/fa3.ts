import type { InvoiceVatTreatment } from './tenant.js';

interface Fa3Party {
  nip: string;
  name: string;
  addressLine: string;
}

interface Fa3Buyer {
  nip: string | null;
  name: string;
  addressLine: string;
}

export interface Fa3InvoiceInput {
  invoiceNumber: string;
  issueDate: string;
  generatedAt: string;
  seller: Fa3Party;
  buyer: Fa3Buyer | null;
  productName: string;
  grossAmountCents: number;
  discountCents: number;
  vat: InvoiceVatTreatment;
}

const escaped = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const money = (cents: number): string => `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

const vatSummarySuffix = (rate: 5 | 8 | 23): '1' | '2' | '3' => {
  if (rate === 23) return '1';
  if (rate === 8) return '2';
  return '3';
};

const buyerXml = (buyer: Fa3Buyer | null): string => {
  if (buyer === null) {
    return '<Podmiot2><DaneIdentyfikacyjne><BrakID>1</BrakID><Nazwa>Klient detaliczny</Nazwa></DaneIdentyfikacyjne><JST>2</JST><GV>2</GV></Podmiot2>';
  }
  const identifier = buyer.nip === null
    ? '<BrakID>1</BrakID>'
    : `<NIP>${escaped(buyer.nip)}</NIP>`;
  return `<Podmiot2><DaneIdentyfikacyjne>${identifier}<Nazwa>${escaped(buyer.name)}</Nazwa></DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju><AdresL1>${escaped(buyer.addressLine)}</AdresL1></Adres><JST>2</JST><GV>2</GV></Podmiot2>`;
};

export const renderFa3Invoice = (input: Fa3InvoiceInput): string => {
  const netCents = input.vat.kind === 'exempt'
    ? input.grossAmountCents
    : Math.round(input.grossAmountCents * 100 / (100 + input.vat.percent));
  const vatCents = input.grossAmountCents - netCents;
  const summary = input.vat.kind === 'exempt'
    ? `<P_13_7>${money(input.grossAmountCents)}</P_13_7>`
    : `<P_13_${vatSummarySuffix(input.vat.percent)}>${money(netCents)}</P_13_${vatSummarySuffix(input.vat.percent)}><P_14_${vatSummarySuffix(input.vat.percent)}>${money(vatCents)}</P_14_${vatSummarySuffix(input.vat.percent)}>`;
  const exemption = input.vat.kind === 'exempt'
    ? `<P_19>1</P_19><${input.vat.basisKind === 'other' ? 'P_19C' : 'P_19A'}>${escaped(input.vat.basis.trim().replace(/\s+/gu, ' ').slice(0, 256))}</${input.vat.basisKind === 'other' ? 'P_19C' : 'P_19A'}>`
    : '<P_19N>1</P_19N>';
  const rate = input.vat.kind === 'exempt' ? 'zw' : String(input.vat.percent);
  const lineName = input.discountCents === 0
    ? input.productName
    : `${input.productName} (rabat kuponowy: ${money(input.discountCents)} PLN)`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"><Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza><WariantFormularza>3</WariantFormularza><DataWytworzeniaFa>${escaped(input.generatedAt)}</DataWytworzeniaFa><SystemInfo>Together</SystemInfo></Naglowek><Podmiot1><DaneIdentyfikacyjne><NIP>${escaped(input.seller.nip)}</NIP><Nazwa>${escaped(input.seller.name)}</Nazwa></DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju><AdresL1>${escaped(input.seller.addressLine)}</AdresL1></Adres></Podmiot1>${buyerXml(input.buyer)}<Fa><KodWaluty>PLN</KodWaluty><P_1>${escaped(input.issueDate)}</P_1><P_2>${escaped(input.invoiceNumber)}</P_2>${summary}<P_15>${money(input.grossAmountCents)}</P_15><Adnotacje><P_16>2</P_16><P_17>2</P_17><P_18>2</P_18><P_18A>2</P_18A><Zwolnienie>${exemption}</Zwolnienie><NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu><P_23>2</P_23><PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy></Adnotacje><RodzajFaktury>VAT</RodzajFaktury><FaWiersz><NrWierszaFa>1</NrWierszaFa><P_7>${escaped(lineName)}</P_7><P_8A>szt.</P_8A><P_8B>1</P_8B><P_9A>${money(netCents)}</P_9A><P_11>${money(netCents)}</P_11><P_12>${rate}</P_12></FaWiersz></Fa></Faktura>\n`;
};

const requiredFragments = [
  ['schema', '<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">'],
  ['KodFormularza', '<KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza>'],
  ['WariantFormularza', '<WariantFormularza>3</WariantFormularza>'],
  ['DataWytworzeniaFa', '<DataWytworzeniaFa>'],
  ['Podmiot1', '<Podmiot1>'],
  ['Podmiot2', '<Podmiot2>'],
  ['P_1', '<P_1>'],
  ['P_2', '<P_2>'],
  ['P_15', '<P_15>'],
  ['Adnotacje', '<Adnotacje>'],
  ['Zwolnienie', '<Zwolnienie>'],
  ['RodzajFaktury', '<RodzajFaktury>VAT</RodzajFaktury>'],
  ['FaWiersz', '<FaWiersz>'],
] as const;

export const validateFa3Structure = (
  xml: string,
): { ok: boolean; errors: string[] } => {
  const errors: string[] = requiredFragments
    .filter(([, fragment]) => !xml.includes(fragment))
    .map(([name]) => name);
  if (xml.startsWith('\uFEFF')) errors.push('utf8-bom');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(xml)) errors.push('xml-characters');
  const ordered = ['<Naglowek>', '<Podmiot1>', '<Podmiot2>', '<Fa>'];
  if (ordered.some((fragment, index) =>
    index > 0 && xml.indexOf(fragment) < xml.indexOf(ordered[index - 1] ?? ''))) {
    errors.push('element-order');
  }
  if (xml.includes('<P_19>1</P_19>')) {
    const bases = ['P_19A', 'P_19B', 'P_19C'].filter((tag) => xml.includes(`<${tag}>`));
    if (bases.length === 0) errors.push('exemption-basis');
    if (bases.length > 1) errors.push('exemption-basis-choice');
    if (xml.includes('<P_19N>')) errors.push('exemption-both-branches');
    if (!xml.includes('<P_12>zw</P_12>')) errors.push('exemption-line-rate');
    if (xml.includes('<P_14_')) errors.push('exemption-vat-amount');
    const exemptSummary = xml.match(/<P_13_7>([^<]+)<\/P_13_7>/u)?.[1];
    const total = xml.match(/<P_15>([^<]+)<\/P_15>/u)?.[1];
    if (exemptSummary === undefined) errors.push('exemption-summary');
    else if (exemptSummary !== total) errors.push('exemption-total-mismatch');
  }
  if (xml.includes('<P_19N>') && xml.includes('<P_12>zw</P_12>')) {
    errors.push('exemption-line-rate');
  }
  return { ok: errors.length === 0, errors };
};
