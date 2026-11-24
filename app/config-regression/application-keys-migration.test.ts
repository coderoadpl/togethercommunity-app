import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = join(import.meta.dirname, '..', 'drizzle', '0169_application_keys.sql');

describe('migration 0169', () => {
  it('only creates its own tables and indexes, so no existing table is locked or rewritten', () => {
    const statements = readFileSync(migration, 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim().split('\n')[0] ?? '');
    expect(statements).toEqual([
      'CREATE TABLE "application_keys" (',
      'CREATE INDEX "application_keys_tenant_id_idx" ON "application_keys" ("tenant_id");',
      'CREATE UNIQUE INDEX "application_keys_key_hash_uidx" ON "application_keys" ("key_hash");',
      'CREATE TABLE "application_key_rate_limit_buckets" (',
    ]);
  });
});
