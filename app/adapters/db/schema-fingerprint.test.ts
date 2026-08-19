import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import committedFingerprint from '../../drizzle/meta/schema-fingerprint.json' with { type: 'json' };

import type { Db } from './client.js';
import {
  canonicalJson,
  fingerprintHash,
  introspectSchema,
  shortFingerprint,
  type SchemaSnapshot,
} from './schema-fingerprint.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

const emptySnapshot: SchemaSnapshot = {
  tables: [],
  constraints: [],
  indexes: [],
  triggers: [],
  functions: [],
  sequences: [],
  views: [],
};

const EMPTY_SNAPSHOT_SHA256 =
  '1a7a8a963dd7a825b47f5f4cac5258202ae291d7af6c4299ec95fbbdedf72d56';

const identifierColumn = {
  name: 'id',
  type: 'text',
  notNull: true,
  default: null,
  identity: '',
  generated: '',
};

const labelColumn = {
  name: 'label',
  type: 'text',
  notNull: false,
  default: null,
  identity: '',
  generated: '',
};

describe('canonical serialization', () => {
  it('ignores object key and array insertion order', () => {
    const left: SchemaSnapshot = {
      ...emptySnapshot,
      tables: [{ name: 'widgets', columns: [identifierColumn, labelColumn] }],
      indexes: [
        { table: 'widgets', name: 'widgets_label_idx', definition: 'CREATE INDEX a' },
        { table: 'widgets', name: 'widgets_id_idx', definition: 'CREATE INDEX b' },
      ],
    };
    const right: SchemaSnapshot = {
      views: [],
      sequences: [],
      functions: [],
      triggers: [],
      indexes: [
        { definition: 'CREATE INDEX b', name: 'widgets_id_idx', table: 'widgets' },
        { definition: 'CREATE INDEX a', name: 'widgets_label_idx', table: 'widgets' },
      ],
      constraints: [],
      tables: [{ columns: [labelColumn, identifierColumn], name: 'widgets' }],
    };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(fingerprintHash(left)).toBe(fingerprintHash(right));
  });

  it('hashes a known vector', () => {
    expect(canonicalJson(emptySnapshot)).toBe(
      '{"constraints":[],"functions":[],"indexes":[],"sequences":[],"tables":[],"triggers":[],"views":[]}',
    );
    expect(fingerprintHash(emptySnapshot)).toBe(EMPTY_SNAPSHOT_SHA256);
    expect(shortFingerprint(EMPTY_SNAPSHOT_SHA256)).toBe('1a7a8a963dd7');
  });
});

describe('schema fingerprint against a freshly migrated database', () => {
  let db: Db;
  let close: () => Promise<void>;
  let baseline: string;

  const currentHash = async (): Promise<string> => fingerprintHash(await introspectSchema(db));

  beforeAll(async () => {
    const testDatabase = await createTestDatabase('together_fingerprint_test', baseDatabaseUrl);
    db = testDatabase.db;
    close = testDatabase.close;
    baseline = await currentHash();
  }, 60_000);

  afterAll(async () => {
    await close();
  });

  it('equals the committed fingerprint', () => {
    expect(baseline).toBe(committedFingerprint.hash);
    expect(shortFingerprint(baseline)).toBe(committedFingerprint.shortId);
  });

  it('normalizes every collected definition', async () => {
    const snapshot = await introspectSchema(db);
    const definitions = [
      ...snapshot.constraints.map((entry) => entry.definition),
      ...snapshot.indexes.map((entry) => entry.definition),
      ...snapshot.triggers.map((entry) => entry.definition),
      ...snapshot.functions.map((entry) => entry.definition),
      ...snapshot.views.map((entry) => entry.definition),
    ];

    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(definition).toBe(definition.replaceAll(/\s+/g, ' ').trim());
      expect(definition).not.toContain('public.');
    }
  });

  it('changes when a column is dropped and returns when it is re-added', async () => {
    await db.execute(sql`alter table products drop column cover_url`);
    expect(await currentHash()).not.toBe(baseline);

    await db.execute(sql`alter table products add column cover_url text`);
    expect(await currentHash()).toBe(baseline);
  });

  it('changes when an extra index appears', async () => {
    await db.execute(sql`create index schema_fingerprint_probe_idx on products (id)`);
    expect(await currentHash()).not.toBe(baseline);

    await db.execute(sql`drop index schema_fingerprint_probe_idx`);
    expect(await currentHash()).toBe(baseline);
  });

  it('changes when a constraint is renamed', async () => {
    await db.execute(
      sql`alter table products rename constraint products_tenant_id_tenants_id_fk to schema_fingerprint_probe_fk`,
    );
    expect(await currentHash()).not.toBe(baseline);

    await db.execute(
      sql`alter table products rename constraint schema_fingerprint_probe_fk to products_tenant_id_tenants_id_fk`,
    );
    expect(await currentHash()).toBe(baseline);
  });

  it('ignores migration bookkeeping and sequence state', async () => {
    await db.execute(
      sql`insert into drizzle.__drizzle_migrations (hash, created_at) values ('schema-fingerprint-probe', 1)`,
    );
    await db.execute(sql`select nextval('member_events_sequence_seq')`);

    expect(await currentHash()).toBe(baseline);
  });
});
