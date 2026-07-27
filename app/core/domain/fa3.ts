export interface Fa3Party {
  nip: string;
  name: string;
  addressLine: string;
}

export interface Fa3InvoiceInput {
  invoiceNumber: string;
  issueDate: string;
  generatedAt: string;
  seller: Fa3Party;
  buyer: Fa3Party | null;
  productName: string;
  grossAmountCents: number;
  discountCents: number;
  vatRatePercent: 5 | 8 | 23;
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

const buyerXml = (buyer: Fa3Party | null): string => {
  if (buyer === null) {
    return '<Podmiot2><DaneIdentyfikacyjne><BrakID>1</BrakID><Nazwa>Klient detaliczny</Nazwa></DaneIdentyfikacyjne><JST>2</JST><GV>2</GV></Podmiot2>';
  }
  return `<Podmiot2><DaneIdentyfikacyjne><NIP>${escaped(buyer.nip)}</NIP><Nazwa>${escaped(buyer.name)}</Nazwa></DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju><AdresL1>${escaped(buyer.addressLine)}</AdresL1></Adres><JST>2</JST><GV>2</GV></Podmiot2>`;
};

export const renderFa3Invoice = (input: Fa3InvoiceInput): string => {
  const netCents = Math.round(input.grossAmountCents * 100 / (100 + input.vatRatePercent));
  const vatCents = input.grossAmountCents - netCents;
  const suffix = vatSummarySuffix(input.vatRatePercent);
  const lineName = input.discountCents === 0
    ? input.productName
    : `${input.productName} (rabat kuponowy: ${money(input.discountCents)} PLN)`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"><Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza><WariantFormularza>3</WariantFormularza><DataWytworzeniaFa>${escaped(input.generatedAt)}</DataWytworzeniaFa><SystemInfo>Together</SystemInfo></Naglowek><Podmiot1><DaneIdentyfikacyjne><NIP>${escaped(input.seller.nip)}</NIP><Nazwa>${escaped(input.seller.name)}</Nazwa></DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju><AdresL1>${escaped(input.seller.addressLine)}</AdresL1></Adres></Podmiot1>${buyerXml(input.buyer)}<Fa><KodWaluty>PLN</KodWaluty><P_1>${escaped(input.issueDate)}</P_1><P_2>${escaped(input.invoiceNumber)}</P_2><P_13_${suffix}>${money(netCents)}</P_13_${suffix}><P_14_${suffix}>${money(vatCents)}</P_14_${suffix}><P_15>${money(input.grossAmountCents)}</P_15><Adnotacje><P_16>2</P_16><P_17>2</P_17><P_18>2</P_18><P_18A>2</P_18A><Zwolnienie><P_19N>1</P_19N></Zwolnienie><NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu><P_23>2</P_23><PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy></Adnotacje><RodzajFaktury>VAT</RodzajFaktury><FaWiersz><NrWierszaFa>1</NrWierszaFa><P_7>${escaped(lineName)}</P_7><P_8A>szt.</P_8A><P_8B>1</P_8B><P_9A>${money(netCents)}</P_9A><P_11>${money(netCents)}</P_11><P_12>${String(input.vatRatePercent)}</P_12></FaWiersz></Fa></Faktura>\n`;
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
  ['RodzajFaktury', '<RodzajFaktury>VAT</RodzajFaktury>'],
  ['FaWiersz', '<FaWiersz>'],
] as const;

export const validateFa3Structure = (
  xml: string,
): { ok: boolean; errors: string[] } => {
  const errors = requiredFragments
    .filter(([, fragment]) => !xml.includes(fragment))
    .map(([name]) => name);
  if (xml.startsWith('\uFEFF')) errors.push('utf8-bom');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(xml)) errors.push('xml-characters');
  const ordered = ['<Naglowek>', '<Podmiot1>', '<Podmiot2>', '<Fa>'];
  if (ordered.some((fragment, index) =>
    index > 0 && xml.indexOf(fragment) < xml.indexOf(ordered[index - 1] ?? ''))) {
    errors.push('element-order');
  }
  return { ok: errors.length === 0, errors };
};
