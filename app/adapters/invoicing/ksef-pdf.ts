import type { KsefInvoicePdf } from '@core/server/index.js';

const xmlText = (xml: string, tag: string): string => {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'u').exec(xml);
  return match?.[1]
    ?.replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'") ?? '';
};

const pdfText = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/gu, '')
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');

const pdf = (lines: string[]): Uint8Array => {
  const stream = [
    'BT',
    '/F1 11 Tf',
    '50 790 Td',
    ...lines.flatMap((line, index) => [
      ...(index === 0 ? [] : ['0 -20 Td']),
      `(${pdfText(line)}) Tj`,
    ]),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${String(Buffer.byteLength(stream))} >>\nstream\n${stream}\nendstream`,
  ];
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
  render: ({ invoice, xml }) => pdf([
    'FAKTURA VAT',
    `Numer: ${xmlText(xml, 'P_2')}`,
    `Data wystawienia: ${xmlText(xml, 'P_1')}`,
    `Sprzedawca: ${invoice.ksef?.sellerName ?? ''}`,
    `NIP sprzedawcy: ${invoice.ksef?.contextNip ?? ''}`,
    `Nabywca: ${xmlText(xml, 'Nazwa')}`,
    `Wartosc brutto: ${xmlText(xml, 'P_15')} PLN`,
    `Numer KSeF: ${invoice.ksef?.ksefNumber ?? 'oczekuje'}`,
  ]),
});
