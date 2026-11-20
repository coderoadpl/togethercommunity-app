import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = join(import.meta.dirname, '..', 'drizzle', '0168_entitlement_keys.sql');

describe('migration 0168', () => {
  it('only creates its own tables and indexes, so no existing table is locked or rewritten', () => {
    const statements = readFileSync(migration, 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim().split('\n')[0] ?? '');
    expect(statements).toEqual([
      'CREATE TABLE "entitlement_keys" (',
      'CREATE INDEX "entitlement_keys_tenant_id_idx" ON "entitlement_keys" ("tenant_id");',
      'CREATE UNIQUE INDEX "entitlement_keys_key_hash_uidx" ON "entitlement_keys" ("key_hash");',
      'CREATE TABLE "entitlement_key_rate_limit_buckets" (',
    ]);
  });
});
