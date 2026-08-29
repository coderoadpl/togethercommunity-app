import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lessonBlockSchema } from '#core/domain/index.js';
import {
  upcastLegacyDocumentUrlV6,
  upcastLegacyLinkUrlV6,
} from '#core/domain/snapshots/course_lesson/v6.js';

const { readFileSync } = process.getBuiltinModule('node:fs');
const { join } = process.getBuiltinModule('node:path');

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const migrationPath = join(process.cwd(), 'drizzle/0088_upcast_lesson_document_urls.sql');

const jsWhitespace = Array.from({ length: 0x10000 }, (_, code) => String.fromCodePoint(code)).filter(
  (character) => /\s/u.test(character),
);

const whitespaceCases = jsWhitespace.flatMap((character) => [
  `${character}/uploads/doc.pdf`,
  `/uploads/doc.pdf${character}`,
  `/uploads/${character}doc.pdf`,
  `${character}https://files.test/doc.pdf`,
  `https://files.test/${character}doc.pdf`,
  `${character}mailto:teacher@example.test`,
]);

const platformCases = [
  '/uploads/doc.pdf',
  '/uploads/Ćwiczenie-1.pdf',
  '/uploads/Zadanie 1.pdf',
  'https://files.test/doc.pdf',
  'https://files.test:8443/doc.pdf',
  'https://files.test/Ćwiczenie 1.pdf',
  'HTTPS://Files.Test/doc.pdf',
  'mailto:teacher@example.test',
  'MAILTO:teacher@example.test',
  'javascript:alert(1)',
  'data:text/html,alert',
  'vbscript:msgbox(1)',
  '//evil.test/doc.pdf',
  '/\\evil.test/doc.pdf',
  '/uploads\\doc.pdf',
  'ftp://files.test/doc.pdf',
  'tel:+48123456789',
  'https://',
  'https://files.test:999999/doc.pdf',
  'http://files^test/doc.pdf',
  'http://files%zz.test/doc.pdf',
  '',
  '/',
];

const unprovableAbsoluteUrls = [
  'https://user:secret@files.test/doc.pdf',
  'https://ćwiczenia.test/doc.pdf',
  'https://[::1]/doc.pdf',
  'https://files\t.test/doc.pdf',
];

const allCases = [...whitespaceCases, ...platformCases, ...unprovableAbsoluteUrls];

interface UpcastRow {
  value: string;
  document: string;
  link: string;
}

describe('0088 lesson URL upcast', () => {
  let client: pg.Client;
  let upcast: Map<string, UpcastRow>;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    const statements = readFileSync(migrationPath, 'utf8')
      .split('--> statement-breakpoint')
      .filter((statement) => statement.includes('CREATE FUNCTION'));
    for (const statement of statements) await client.query(statement);
    const rows = await client.query<UpcastRow>(
      `SELECT "value",
              pg_temp.upcast_lesson_document_url_v6("value") AS "document",
              pg_temp.upcast_lesson_link_url_v6("value") AS "link"
       FROM unnest($1::text[]) AS "input"("value")`,
      [allCases],
    );
    upcast = new Map(rows.rows.map((row) => [row.value, row]));
  });

  afterAll(async () => {
    await client.end();
  });

  const rowFor = (value: string): UpcastRow => {
    const row = upcast.get(value);
    if (row === undefined) throw new Error(`no upcast result for ${JSON.stringify(value)}`);
    return row;
  };

  it('leaves every row parseable by the tightened lesson block schemas', () => {
    for (const value of allCases) {
      const row = rowFor(value);
      expect(
        lessonBlockSchema.safeParse({ type: 'pdf', pdfUrl: row.document }).success,
        `pdf ${JSON.stringify(value)} -> ${JSON.stringify(row.document)}`,
      ).toBe(true);
      expect(
        lessonBlockSchema.safeParse({ type: 'link', url: row.link }).success,
        `link ${JSON.stringify(value)} -> ${JSON.stringify(row.link)}`,
      ).toBe(true);
    }
  });

  it('agrees with the TypeScript upcast on whitespace and platform-written URLs', () => {
    for (const value of [...whitespaceCases, ...platformCases]) {
      const row = rowFor(value);
      expect(row.document, `pdf ${JSON.stringify(value)}`).toBe(upcastLegacyDocumentUrlV6(value));
      expect(row.link, `link ${JSON.stringify(value)}`).toBe(upcastLegacyLinkUrlV6(value));
    }
  });

  it('parks absolute URLs whose authority it cannot prove parseable', () => {
    for (const value of unprovableAbsoluteUrls) {
      const row = rowFor(value);
      expect(row.document).toBe(`https://legacy-document.invalid/?url=${encodeURIComponent(value)}`);
      expect(row.link).toBe(`https://legacy-link.invalid/?url=${encodeURIComponent(value)}`);
      expect(upcastLegacyDocumentUrlV6(value)).toBe(value);
    }
  });
});
