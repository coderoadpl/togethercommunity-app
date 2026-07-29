import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Emits a tiny, valid single-page PDF used as the seeded lesson attachment.
 * Kept ASCII-only (Helvetica/WinAnsi) so it renders without embedded fonts, and
 * served same-origin so the lesson player can frame it inline.
 */
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  null,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];

const stream = [
  'BT',
  '/F1 24 Tf',
  '72 760 Td',
  '(Together - przykladowa lekcja PDF) Tj',
  '0 -36 Td',
  '/F1 12 Tf',
  '(Ten dokument jest hostowany same-origin, wiec osadza sie w ramce.) Tj',
  'ET',
].join('\n');

objects[3] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;

const header = '%PDF-1.4\n';
let body = '';
const offsets: number[] = [];
objects.forEach((content, index) => {
  offsets.push(header.length + Buffer.byteLength(body, 'latin1'));
  body += `${index + 1} 0 obj\n${content ?? ''}\nendobj\n`;
});

const xrefStart = header.length + Buffer.byteLength(body, 'latin1');
let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const offset of offsets) {
  xref += `${offset.toString().padStart(10, '0')} 00000 n \n`;
}
const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

const pdf = Buffer.from(header + body + xref + trailer, 'latin1');

const outPath = fileURLToPath(new URL('../apps/web/public/assets/sample-lekcja.pdf', import.meta.url));
mkdirSync(fileURLToPath(new URL('../apps/web/public/assets/', import.meta.url)), { recursive: true });
writeFileSync(outPath, pdf);
console.log(`Wrote ${pdf.length} bytes to ${outPath}`);
