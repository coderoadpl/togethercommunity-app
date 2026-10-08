import type { KsefInvoicePdf } from '#core/server/index.js';

const decodeXml = (value: string): string =>
  value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");

const section = (xml: string, tag: string): string =>
  new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'u').exec(xml)?.[0] ?? '';

const sections = (xml: string, tag: string): string[] =>
  [...xml.matchAll(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'gu'))]
    .map((match) => match[0]);

const values = (xml: string, tag: string): string[] =>
  [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'gu'))]
    .map((match) => decodeXml(match[1] ?? ''));

const value = (xml: string, tag: string): string => values(xml, tag)[0] ?? '';

const ascii = (text: string): string =>
  text
    .replaceAll('Ł', 'L')
    .replaceAll('ł', 'l')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/gu, '');

const escaped = (text: string): string =>
  ascii(text)
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');

interface TextLine {
  x: number;
  y: number;
  text: string;
  size?: number;
  bold?: boolean;
}

const createPdf = (lines: TextLine[], rules: Array<{ y: number; width?: number }>): Uint8Array => {
  const pageFor = (y: number): number => Math.max(0, Math.floor((790 - y) / 745));
  const pageCount = Math.max(1, ...lines.map((line) => pageFor(line.y) + 1));
  const regularFont = 3 + pageCount * 2;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${String(3 + index * 2)} 0 R`).join(' ')}] /Count ${String(pageCount)} >>`,
  ];
  for (let page = 0; page < pageCount; page += 1) {
    const stream = [
      '0.82 G',
      ...rules.filter((rule) => pageFor(rule.y) === page).map((rule) =>
        `45 ${String(rule.y + page * 745)} m ${String(45 + (rule.width ?? 505))} ${String(rule.y + page * 745)} l S`),
      '0 g',
      ...lines.filter((line) => pageFor(line.y) === page).flatMap((line) => [
        'BT',
        `/${line.bold === true ? 'F2' : 'F1'} ${String(line.size ?? 10)} Tf`,
        `${String(line.x)} ${String(line.y + page * 745)} Td`,
        `(${escaped(line.text)}) Tj`,
        'ET',
      ]),
    ].join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${String(regularFont)} 0 R /F2 ${String(regularFont + 1)} 0 R >> >> /Contents ${String(4 + page * 2)} 0 R >>`,
      `<< /Length ${String(Buffer.byteLength(stream))} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new TextEncoder().encode(body);
};

export const createKsefInvoicePdf = (): KsefInvoicePdf => ({
  render: ({ invoice, xml }) => {
    const seller = section(xml, 'Podmiot1');
    const buyer = section(xml, 'Podmiot2');
    const rows = sections(xml, 'FaWiersz').map((row, index) => ({
      number: value(row, 'NrWierszaFa') || String(index + 1),
      name: value(row, 'P_7'),
      quantity: value(row, 'P_8B'),
      unit: value(row, 'P_8A'),
      netUnit: value(row, 'P_9A'),
      net: value(row, 'P_11'),
      vat: value(row, 'P_12'),
    }));
    const exempt = rows.some((row) => row.vat === 'zw');
    const summaries = ([['23', '1'], ['8', '2'], ['5', '3'], ['zw', '7']] as const)
      .filter(([rate]) => rows.some((row) => row.vat === rate));
    const summaryTop = Math.min(500, 576 - rows.length * 24);
    const footerTop = summaryTop - 52 - summaries.length * 36;
    const lines: TextLine[] = [
      { x: 45, y: 790, text: 'FAKTURA VAT', size: 20, bold: true },
      { x: 45, y: 765, text: `Numer: ${value(xml, 'P_2')}`, size: 11, bold: true },
      { x: 360, y: 765, text: `Data wystawienia: ${value(xml, 'P_1')}` },
      { x: 45, y: 720, text: 'SPRZEDAWCA', size: 9, bold: true },
      { x: 45, y: 702, text: value(seller, 'Nazwa'), bold: true },
      { x: 45, y: 686, text: `NIP: ${value(seller, 'NIP')}` },
      { x: 45, y: 670, text: value(seller, 'AdresL1') },
      { x: 310, y: 720, text: 'NABYWCA', size: 9, bold: true },
      { x: 310, y: 702, text: value(buyer, 'Nazwa') || 'Konsument', bold: true },
      { x: 310, y: 686, text: value(buyer, 'NIP') ? `NIP: ${value(buyer, 'NIP')}` : 'bez NIP' },
      { x: 310, y: 670, text: value(buyer, 'AdresL1') },
      { x: 45, y: 625, text: 'Lp.', bold: true },
      { x: 75, y: 625, text: 'Nazwa', bold: true },
      { x: 315, y: 625, text: 'Ilosc', bold: true },
      { x: 370, y: 625, text: 'Netto', bold: true },
      { x: 440, y: 625, text: 'VAT', bold: true },
      { x: 495, y: 625, text: 'Wartosc', bold: true },
      ...rows.flatMap((row, index): TextLine[] => {
        const y = 600 - index * 24;
        return [
          { x: 45, y, text: row.number },
          { x: 75, y, text: row.name.slice(0, 40) },
          { x: 315, y, text: `${row.quantity} ${row.unit}` },
          { x: 370, y, text: row.netUnit },
          { x: 440, y, text: row.vat === 'zw' ? 'zw' : `${row.vat}%` },
          { x: 495, y, text: row.net },
        ];
      }),
      { x: 330, y: summaryTop, text: 'Podsumowanie VAT', size: 11, bold: true },
      ...summaries.flatMap(([rate, suffix], index): TextLine[] => [
        { x: 330, y: summaryTop - 22 - index * 36, text: rate === 'zw' ? `Wartosc sprzedazy zwolnionej: ${value(xml, 'P_13_7')} PLN` : `Netto: ${value(xml, `P_13_${suffix}`)} PLN` },
        { x: 330, y: summaryTop - 40 - index * 36, text: rate === 'zw' ? 'VAT: 0.00 PLN' : `VAT ${rate}%: ${value(xml, `P_14_${suffix}`)} PLN` },
      ]),
      { x: 330, y: footerTop + 24, text: `${summaries.length === 1 && exempt ? 'Razem' : 'Razem brutto'}: ${value(xml, 'P_15')} PLN`, size: 12, bold: true },
      ...(exempt
        ? [{
            x: 45,
            y: footerTop - 17,
            text: `Zwolnienie z VAT: ${value(xml, 'P_19A') || value(xml, 'P_19C')}`,
          }]
        : []),
      { x: 45, y: footerTop - 47, text: 'NUMER KSeF', size: 9, bold: true },
      { x: 45, y: footerTop - 69, text: invoice.ksef?.ksefNumber ?? 'Oczekuje na przyjecie w KSeF', size: 12, bold: true },
      { x: 45, y: footerTop - 117, text: 'Weryfikacja', size: 9, bold: true },
      {
        x: 45,
        y: footerTop - 135,
        text: 'Wizualizacja faktury ustrukturyzowanej FA(3). Zweryfikuj numer KSeF w systemie Ministerstwa Finansow.',
        size: 8,
      },
      { x: 45, y: footerTop - 154, text: `SHA-256 XML: ${invoice.ksef?.xmlSha256 ?? ''}`, size: 7 },
    ];
    return createPdf(lines, [{ y: 750 }, { y: 642 }, { y: 612 }, { y: footerTop - 2 }, { y: footerTop - 92 }]);
  },
});
