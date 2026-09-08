import type { MarketingContactView } from './marketing-contact.js';
import type { z } from 'zod';

import { validation, type AppError } from './errors.js';
import { err, ok, type Result } from './result.js';
import { MARKETING_IMPORT_LIMITS, marketingImportFieldSchema, marketingImportMappingSchema, type MarketingImportCreateInput } from './marketing-contact-import.js';

export type MarketingCsv = { headers: string[]; rows: string[][]; delimiter: ',' | ';' };
const parseRecords = (source: string, delimiter: ',' | ';'): Result<string[][], AppError> => {
  source = source.replace(/[\r\n \t]+$/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  const finishField = () => { row.push(field.trim()); field = ''; state = 'start'; };
  const finishRow = () => { finishField(); rows.push(row); row = []; };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === undefined) break;
    if (state === 'quoted') {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; }
        else state = 'closed';
      } else field += char;
      continue;
    }
    if (char === delimiter) { finishField(); continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      finishRow();
      if (rows.length > MARKETING_IMPORT_LIMITS.rows + 2) return err(validation('CSV exceeds 10,000 rows'));
      continue;
    }
    if (state === 'closed') {
      if (char === ' ' || char === '\t') continue;
      return err(validation('Unexpected content after a quoted CSV field'));
    }
    if (char === '"') {
      if (state === 'start' && field.trim() === '') { field = ''; state = 'quoted'; }
      else return err(validation('Quote inside an unquoted CSV field'));
    } else {
      field += char;
      if (char !== ' ' && char !== '\t') state = 'plain';
    }
  }
  if (state === 'quoted') return err(validation('Unclosed quoted CSV field'));
  if (field !== '' || row.length > 0 || state === 'closed') finishRow();
  while (rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === '') rows.pop();
  const header = rows[0];
  if (header === undefined || header.some((name) => name === '')) return err(validation('A non-empty CSV header is required'));
  if (new Set(header).size !== header.length) return err(validation('Duplicate CSV header names'));
  if (rows.some((record) => record.length !== header.length)) return err(validation('Inconsistent CSV record width'));
  if (rows.length - 1 > MARKETING_IMPORT_LIMITS.rows) return err(validation('CSV exceeds 10,000 rows'));
  return ok(rows);
};

export const parseMarketingImportCsv = (source: string, delimiter?: ',' | ';'): Result<MarketingCsv, AppError> => {
  if (new TextEncoder().encode(source).length > MARKETING_IMPORT_LIMITS.csvBytes) return err(validation('CSV exceeds 3 MiB'));
  if (source.includes('\u0000') || source.includes('\ufffd')) return err(validation('CSV must contain valid UTF-8 text'));
  const text = source.replace(/^\ufeff/, '');
  if (delimiter === undefined) {
    const comma = parseRecords(text, ',');
    const semicolon = parseRecords(text, ';');
    const candidates = [
      ...(comma.ok && (comma.value[0]?.length ?? 0) > 1 ? [',' as const] : []),
      ...(semicolon.ok && (semicolon.value[0]?.length ?? 0) > 1 ? [';' as const] : []),
    ];
    if (comma.ok && semicolon.ok && JSON.stringify(comma.value) === JSON.stringify(semicolon.value)) candidates.splice(0, candidates.length, ',');
    if (candidates.length !== 1) return err(validation('Delimiter is ambiguous or CSV is malformed; choose comma or semicolon explicitly'));
    delimiter = candidates[0];
  }
  if (delimiter === undefined) return err(validation('Choose a CSV delimiter'));
  const parsed = parseRecords(text, delimiter);
  if (!parsed.ok) return parsed;
  const [headers, ...rows] = parsed.value;
  return headers === undefined ? err(validation('CSV header is required')) : ok({ headers, rows, delimiter });
};

export const mapMarketingImportCsv = (
  csv: MarketingCsv,
  input: { kind: MarketingImportCreateInput['kind']; mapping?: Record<string, z.output<typeof marketingImportFieldSchema>> | undefined; defaults?: MarketingImportCreateInput['defaults'] | undefined },
): Result<{ rows: Record<string, unknown>[]; mapping: Record<string, z.output<typeof marketingImportFieldSchema>>; unknownColumns: string[]; warnings: { rowNumber: number; message: string }[] }, AppError> => {
  const allowed = input.kind === 'contacts'
    ? ['email', 'name', 'firstName', 'lastName', 'tags', 'source', 'consentSource', 'consentAt', 'lists']
    : ['email', 'reason', 'at'];
  const automatic = Object.fromEntries(csv.headers.flatMap((header) => {
    const field = marketingImportFieldSchema.safeParse(header);
    return field.success && allowed.includes(field.data) ? [[header, field.data]] : [];
  }));
  const mapping = marketingImportMappingSchema.safeParse(input.mapping ?? automatic);
  if (!mapping.success) return err(validation('Invalid CSV column mapping', mapping.error.flatten()));
  if (Object.keys(mapping.data).some((header) => !csv.headers.includes(header)) || Object.values(mapping.data).some((field) => !allowed.includes(field))) return err(validation('Mapping references an absent header or unsupported field'));
  const fields = Object.values(mapping.data);
  if (!fields.includes('email')) return err(validation('Map the required email column'));
  if (input.kind === 'suppressions' && ((!fields.includes('reason') && input.defaults?.reason === undefined) || (!fields.includes('at') && input.defaults?.at === undefined))) return err(validation('Suppression imports require reason and at columns or explicit defaults'));
  const warnings: { rowNumber: number; message: string }[] = [];
  for (const [column, header] of csv.headers.entries()) {
    const field = mapping.data[header];
    if (field !== 'tags' && field !== 'lists') continue;
    warnings.push({ rowNumber: 0, message: `${header}: pipes separate ${field}; literal pipes inside a token are unsupported` });
    for (const [index, record] of csv.rows.entries()) {
      const value = record[column] ?? '';
      if (/\\\||"[^"]*\|[^"]*"/.test(value)) return err(validation(`Row ${index + 1}, ${header}: a pipe inside a tag or list token is unsupported; remove literal pipes before mapping`));
    }
  }
  const rows = csv.rows.map((record) => Object.fromEntries(csv.headers.flatMap((header, index) => {
    const field = mapping.data[header];
    const value = record[index]?.trim() ?? '';
    if (field === undefined || (value === '' && field !== 'email')) return [];
    return [[field, field === 'tags' || field === 'lists' ? value.split('|').map((token) => token.trim()) : value]];
  })));
  return ok({ rows, mapping: mapping.data, warnings, unknownColumns: csv.headers.filter((header) => mapping.data[header] === undefined) });
};

export const marketingCsvCell = (value: string, spreadsheetSafe = false): string => {
  const safe = spreadsheetSafe && /^[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  return /[",;\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export const renderMarketingContactCsv = (contacts: MarketingContactView[], spreadsheetSafe = false): string => {
  const header = ['email', 'name', 'firstName', 'lastName', 'tags', 'source', 'lists', 'archivedAt', 'memberId', 'consentState', 'suppressionReason'];
  const rows = contacts.map((contact) => [contact.email, contact.displayName ?? '', contact.firstName ?? '', contact.lastName ?? '', contact.tags.join('|'), contact.source, contact.listKeys.join('|'), contact.archivedAt ?? '', contact.memberId ?? '', contact.consentState ?? '', contact.suppressionReason ?? '']);
  return [header, ...rows].map((row) => row.map((value) => marketingCsvCell(value, spreadsheetSafe)).join(',')).join('\r\n') + '\r\n';
};
