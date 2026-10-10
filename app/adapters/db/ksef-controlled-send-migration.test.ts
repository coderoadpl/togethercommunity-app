import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
let database: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => { database = await createTestDatabase('together_ksef_migration', baseDatabaseUrl); });
afterAll(async () => { await database?.close(); });

describe('controlled KSeF migration', () => {
  it.each([
    { history: 'TEST only', productionSequence: null, testSequence: 1, reservedSequence: null },
    { history: 'TEST after production', productionSequence: 7, testSequence: 8, reservedSequence: null },
    { history: 'production after TEST', productionSequence: 9, testSequence: 8, reservedSequence: null },
    { history: 'unmatched production reservation', productionSequence: 7, testSequence: 8, reservedSequence: 9 },
  ])('expands $history without rewriting fiscal state or breaking legacy allocation', async ({ productionSequence, testSequence, reservedSequence }) => {
    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    try {
      await client.query(`
        CREATE TEMP TABLE tenants (id text PRIMARY KEY);
        CREATE TEMP TABLE invoices (tenant_id text, order_id text, ksef jsonb);
        CREATE TEMP TABLE ksef_number_allocations (
          id text PRIMARY KEY, tenant_id text, invoice_type text, year integer, sequence integer,
          p2 text, order_id text, allocated_at text
        );
        CREATE TEMP TABLE ksef_number_sequences (
          id text PRIMARY KEY, tenant_id text, invoice_type text, year integer, next_value integer, updated_at text
        );
        CREATE UNIQUE INDEX ksef_number_allocations_tenant_type_sequence_uidx ON ksef_number_allocations (tenant_id, invoice_type, year, sequence);
        CREATE UNIQUE INDEX ksef_number_allocations_tenant_type_p2_uidx ON ksef_number_allocations (tenant_id, invoice_type, p2);
        CREATE UNIQUE INDEX ksef_number_allocations_tenant_order_uidx ON ksef_number_allocations (tenant_id, order_id);
        CREATE UNIQUE INDEX ksef_number_sequences_tenant_type_year_uidx ON ksef_number_sequences (tenant_id, invoice_type, year);
        INSERT INTO tenants VALUES ('tenant');
      `);
      const nextValue = Math.max(productionSequence ?? 0, testSequence, reservedSequence ?? 0) + 1;
      await client.query("INSERT INTO ksef_number_sequences VALUES ('legacy-sequence', 'tenant', 'VAT', 2026, $1, '2026-10-01T00:00:00.000Z')", [nextValue]);
      const addAllocation = async (id: string, sequence: number, environment: string | null): Promise<void> => {
        const p2 = `FV/2026/${String(sequence).padStart(6, '0')}`;
        await client.query("INSERT INTO ksef_number_allocations VALUES ($1, 'tenant', 'VAT', 2026, $2, $3, $1, '2026-10-01T00:00:00.000Z')", [id, sequence, p2]);
        if (environment !== null) {
          await client.query("INSERT INTO invoices VALUES ('tenant', $1, $2)", [id, JSON.stringify({ environment, p2 })]);
        }
      };
      if (productionSequence !== null) await addAllocation('production-row', productionSequence, 'production');
      if (reservedSequence !== null) await addAllocation('reserved-row', reservedSequence, null);
      await addAllocation('test-row', testSequence, 'test');
      const before = await client.query("SELECT id, p2, sequence, xmin::text FROM ksef_number_allocations ORDER BY id");
      const beforeCounters = await client.query('SELECT id, next_value, updated_at, xmin::text FROM ksef_number_sequences ORDER BY id');
      const beforeIndexes = await client.query("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = (SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()) ORDER BY indexname");
      const beforeInvoices = await client.query('SELECT *, xmin::text FROM invoices ORDER BY order_id');
      await client.query(readFileSync('drizzle/0139_ksef_controlled_send.sql', 'utf8'));
      expect((await client.query("SELECT id, p2, sequence, xmin::text FROM ksef_number_allocations WHERE environment = 'production' ORDER BY id")).rows).toEqual(before.rows);
      expect((await client.query('SELECT *, xmin::text FROM invoices ORDER BY order_id')).rows).toEqual(beforeInvoices.rows);
      expect((await client.query("SELECT next_value FROM ksef_number_sequences WHERE environment = 'production'")).rows).toEqual([{ next_value: nextValue }]);
      expect((await client.query("SELECT p2, environment FROM ksef_number_allocations WHERE id = 'test-row'")).rows).toEqual([{ p2: `FV/2026/${String(testSequence).padStart(6, '0')}`, environment: 'production' }]);
      expect((await client.query("SELECT next_value FROM ksef_number_sequences WHERE environment = 'test'")).rows).toEqual([]);
      expect((await client.query('SELECT id, next_value, updated_at, xmin::text FROM ksef_number_sequences ORDER BY id')).rows).toEqual(beforeCounters.rows);
      const afterIndexes = await client.query("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = (SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()) ORDER BY indexname");
      expect(afterIndexes.rows).toEqual(expect.arrayContaining(beforeIndexes.rows));
      expect(afterIndexes.rows).toHaveLength(beforeIndexes.rows.length + 4);
      expect((await client.query('SELECT ksef_submission_mode FROM tenants')).rows).toEqual([{ ksef_submission_mode: 'automatic' }]);
      const allocated = await client.query("INSERT INTO ksef_number_sequences (id, tenant_id, invoice_type, year, next_value, updated_at) VALUES ('legacy-next', 'tenant', 'VAT', 2026, 2, '2026-10-02T00:00:00.000Z') ON CONFLICT (tenant_id, invoice_type, year) DO UPDATE SET next_value = ksef_number_sequences.next_value + 1 RETURNING next_value - 1 AS sequence");
      expect(allocated.rows).toEqual([{ sequence: nextValue }]);
      await client.query("INSERT INTO ksef_number_allocations VALUES ('next-production', 'tenant', 'VAT', 2026, $1, $2, 'new-order', '2026-10-02T00:00:00.000Z', 'production')", [nextValue, `FV/2026/${String(nextValue).padStart(6, '0')}`]);
    } finally {
      await client.end();
    }
  });
});
