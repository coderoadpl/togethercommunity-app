import { describe, expect, it } from 'vitest';

import { parseMarketingImportCsv, mapMarketingImportCsv, marketingCsvCell } from './marketing-import-csv.js';

const parsed = (source: string, delimiter?: ',' | ';') => {
  const result = parseMarketingImportCsv(source, delimiter);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
describe('marketing CSV', () => {
  it('parses BOM, CRLF, quoting, doubled quotes and multiline values', () => {
    const csv = parsed('\ufeffemail;name;tags\r\na@example.test;"Example; \"\"A\"\"\r\nSecond line";one|two\r\n\r\n');
    expect(csv.delimiter).toBe(';');
    expect(csv.rows).toEqual([['a@example.test', 'Example; "A"\r\nSecond line', 'one|two']]);
    expect(mapMarketingImportCsv(csv, { kind: 'contacts' })).toMatchObject({ ok: true, value: { rows: [{ email: 'a@example.test', tags: ['one', 'two'] }] } });
  });
  it.each(['email,name\na@example.test,"unfinished', 'email,name\na@example.test,x"y', 'email,name\na@example.test,"x"bad', 'email,name\na@example.test', 'email,email\na@example.test,a@example.test'])('rejects malformed records: %s', (source) => {
    expect(parseMarketingImportCsv(source, ',').ok).toBe(false);
  });
  it('requires a choice when both delimiter interpretations are plausible', () => {
    const source = 'email,name;source\na@example.test,Name;external';
    expect(parseMarketingImportCsv(source).ok).toBe(false);
    expect(parsed(source, ',').headers).toEqual(['email', 'name;source']);
  });
  it('rejects duplicate mappings and reports unknown columns', () => {
    const csv = parsed('email,name,other\na@example.test,A,value');
    expect(mapMarketingImportCsv(csv, { kind: 'contacts', mapping: { email: 'email', name: 'email' } }).ok).toBe(false);
    expect(mapMarketingImportCsv(csv, { kind: 'contacts' })).toMatchObject({ ok: true, value: { unknownColumns: ['other'], rows: [{ email: 'a@example.test', name: 'A' }] } });
  });
  it('requires explicit suppression defaults for legacy email-only input', () => {
    const csv = parsed('email\na@example.test\n');
    expect(mapMarketingImportCsv(csv, { kind: 'suppressions' }).ok).toBe(false);
    expect(mapMarketingImportCsv(csv, { kind: 'suppressions', defaults: { reason: 'manual', at: '2025-01-01T00:00:00Z' } }).ok).toBe(true);
  });
  it.each(['email\n', '\ufeffemail\r\n"a@example.test"\r\n', 'email\na@example.test\nb@example.test\n\n'])('accepts identical single-column parses: %s', (source) => {
    expect(parseMarketingImportCsv(source)).toEqual(parseMarketingImportCsv(source, ','));
  });
  it.each(['tags', 'lists'])('reports pipe semantics and rejects literal pipe escapes in %s during mapping', (field) => {
    expect(mapMarketingImportCsv(parsed(`email,${field}\na@example.test,one|two\n`), { kind: 'contacts' })).toMatchObject({ ok: true, value: { rows: [{ [field]: ['one', 'two'] }], warnings: [{ rowNumber: 0, message: expect.stringContaining('literal pipes') }] } });
    for (const value of ['one\\|two', '"""one|two"""']) {
      expect(mapMarketingImportCsv(parsed(`email,${field}\na@example.test,${value}\n`), { kind: 'contacts' })).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('pipe inside') } });
    }
  });
  it('enforces byte and row limits and ignores only trailing blank records', () => {
    expect(parseMarketingImportCsv('x'.repeat(3 * 1024 * 1024 + 1), ',').ok).toBe(false);
    expect(parseMarketingImportCsv('email,name\n' + 'a@example.test,A\n'.repeat(10_001), ',').ok).toBe(false);
    expect(parsed('email,name\na@example.test,A\n\n').rows).toHaveLength(1);
    expect(parseMarketingImportCsv('email,name\n\na@example.test,A', ',').ok).toBe(false);
  });
  it('keeps machine identity lossless and offers explicit spreadsheet escaping', () => {
    expect(marketingCsvCell('+alias@example.test')).toBe('+alias@example.test');
    expect(marketingCsvCell('=SUM(A1)', true)).toBe("'=SUM(A1)");
    expect(marketingCsvCell('A,"B"')).toBe('"A,""B"""');
  });
});
