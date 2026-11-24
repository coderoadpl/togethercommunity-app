import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = join(import.meta.dirname, '..', 'drizzle', '0169_application_keys.sql');

const tableChangingKeywords = (sql: string): string[] =>
  [...sql.matchAll(/(?<!\bON\s+)\b(?:ALTER|DROP|UPDATE|TRUNCATE|DELETE)\b/giu)].map((match) => match[0]);

describe('migration 0169', () => {
  it('creates only its two new tables and their indexes, and alters or rewrites no existing table', () => {
    const sql = readFileSync(migration, 'utf8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim().split('\n')[0] ?? '');
    expect(statements).toEqual([
      'CREATE TABLE "application_keys" (',
      'CREATE INDEX "application_keys_tenant_id_idx" ON "application_keys" ("tenant_id");',
      'CREATE UNIQUE INDEX "application_keys_key_hash_uidx" ON "application_keys" ("key_hash");',
      'CREATE TABLE "application_key_rate_limit_buckets" (',
    ]);
    expect(tableChangingKeywords(sql)).toEqual([]);
  });

  it('finds a statement that changes an existing table while allowing a foreign key action', () => {
    expect(tableChangingKeywords('"tenant_id" text REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE')).toEqual([]);
    expect(tableChangingKeywords('ALTER TABLE "members" ADD COLUMN "x" text;\nupdate "user" set "name" = \'\';\nDROP INDEX "i";\nTRUNCATE "t";\nDELETE FROM "t";'))
      .toEqual(['ALTER', 'update', 'DROP', 'TRUNCATE', 'DELETE']);
  });
});
