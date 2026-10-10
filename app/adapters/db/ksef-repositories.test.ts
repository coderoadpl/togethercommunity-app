import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { ok, err, validation } from '#core/domain/index.js';
import { requestInvoice, sendInvoice, type InvoiceDeps } from '#core/server/usecases/invoices.js';
import { createContentHash } from '../crypto/content-hash.js';
import { createKsefCredentialResolver } from '../crypto/ksef-credential-resolver.js';
import { createTenantSecretResolver } from '../crypto/tenant-secret-resolver.js';
import { createFakeInvoicing } from '../invoicing/fake.js';
import { createInvoiceRepository } from './invoice-repositories.js';
import { createOrderRepository, createTenantRepository, createTenantSecretRepository } from './repositories.js';
import { fiscalArtifacts, invoiceEvents, ksefNumberAllocations, ksefNumberSequences } from './schema.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Db } from './client.js';
import * as schema from './schema.js';
import {
  createKsefNumberRepository,
  createFiscalArtifactRepository,
  createKsefSubmissionJobRepository,
} from './ksef-repositories.js';
import {
  invoices,
  ksefSubmissionJobs,
  members,
  orders,
  products,
  tenants,
} from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const now = '2026-07-27T10:00:00.000Z';
let db: Db;
let testDatabaseUrl: string;
let closeTestDatabase: () => Promise<void>;

afterAll(async () => {
  await closeTestDatabase();
});

beforeAll(async () => {
  const testDatabase = await createTestDatabase('together_ksef_test', baseDatabaseUrl);
  db = testDatabase.db;
  testDatabaseUrl = testDatabase.url;
  closeTestDatabase = testDatabase.close;
  await db.insert(tenants).values({
    id: 'tenant-ksef',
    slug: 'ksef',
    name: 'KSeF',
    createdAt: now,
  });
  await db.insert(members).values({
    id: 'member-ksef',
    tenantId: 'tenant-ksef',
    userId: 'user-ksef',
    email: 'buyer@example.com',
    createdAt: now,
  });
  await db.insert(products).values({
    id: 'product-ksef',
    tenantId: 'tenant-ksef',
    type: 'course',
    slug: 'course',
    title: 'Course',
    description: '',
    priceCents: 7900,
    currency: 'PLN',
    createdAt: now,
  });
  await db.insert(orders).values(Array.from({ length: 25 }, (_, index) => ({
    id: `order-${String(index + 1)}`,
    tenantId: 'tenant-ksef',
    memberId: 'member-ksef',
    productId: 'product-ksef',
    kind: 'one_time' as const,
    status: 'paid' as const,
    amountCents: 7900,
    currency: 'PLN',
    provider: 'simulated' as const,
    createdAt: now,
  })));
}, 60_000);

describe('KSeF invoice numbering', () => {
  it('allocates a unique immutable sequence under concurrency', async () => {
    const repository = createKsefNumberRepository(db);
    const allocated = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        repository.allocate('tenant-ksef', {
          orderId: `order-${String(index + 1)}`,
          invoiceType: 'VAT',
          year: 2026,
          allocatedAt: now,
        })),
    );

    expect(new Set(allocated.map((item) => item.p2)).size).toBe(20);
    expect(allocated.map((item) => item.sequence).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(await repository.allocate('tenant-ksef', {
      orderId: 'order-1',
      invoiceType: 'VAT',
      year: 2026,
      allocatedAt: now,
    })).toEqual(allocated[0]);
  });
});

describe('KSeF submission jobs', () => {
  it('serializes each tenant under concurrent claims and reclaims an expired lease', async () => {
    await db.insert(invoices).values([1, 2].map((sequence) => ({
      id: `invoice-job-${String(sequence)}`,
      tenantId: 'tenant-ksef',
      orderId: `order-${String(sequence)}`,
      status: 'queued' as const,
      provider: 'ksef',
      createdAt: new Date(Date.parse(now) + sequence).toISOString(),
    })));
    await db.insert(ksefSubmissionJobs).values([1, 2].map((sequence) => ({
      id: `job-${String(sequence)}`,
      tenantId: 'tenant-ksef',
      invoiceId: `invoice-job-${String(sequence)}`,
      status: 'queued' as const,
      nextAttemptAt: now,
      createdAt: new Date(Date.parse(now) + sequence).toISOString(),
    })));
    const repository = createKsefSubmissionJobRepository(db);

    const claimed = await Promise.all([
      repository.claimDue(now),
      repository.claimDue(now),
    ]);

    expect(claimed.filter((job) => job !== null)).toHaveLength(1);
    expect(claimed.filter((job) => job === null)).toHaveLength(1);
    expect(claimed.find((job) => job !== null)).toMatchObject({
      id: 'job-1',
      status: 'running',
      attempts: 1,
    });

    const reclaimed = await repository.claimDue(
      new Date(Date.parse(now) + 16 * 60 * 1000).toISOString(),
    );

    expect(reclaimed).toMatchObject({
      id: 'job-1',
      status: 'running',
      attempts: 2,
    });
  });
});

const ownerContext = {
  identity: {
    userId: 'owner-ksef', email: 'owner@example.com', name: 'Owner', emailVerified: true,
    tenantAccess: 'staff' as const, tenantId: 'tenant-ksef', tenantSlug: 'ksef', tenantName: 'KSeF',
    staffRole: 'owner' as const, memberId: null, image: null, memberDisplayName: null,
    memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
  },
};

const unexpectedTransport = async (): Promise<never> => {
  throw new Error('Invoice creation and sending must not call a transport');
};

const invoiceDeps = (database: Db = db): InvoiceDeps => ({
  invoices: createInvoiceRepository(database),
  invoicing: createFakeInvoicing(),
  orderDetails: createOrderRepository(database),
  tenants: createTenantRepository(database),
  tenantSecrets: createTenantSecretRepository(database),
  secretCrypto: {
    encrypt: (plaintext) => ({ ciphertext: plaintext, iv: 'iv', authTag: 'tag' }),
    decrypt: (secret) => ok(secret.ciphertext),
  },
  ids: { nextId: () => crypto.randomUUID() },
  clock: { nowIso: () => now },
  ksef: {
    environment: 'production',
    credentials: { resolve: async (_tenantId, mode = 'live') => ok({ tenantId: 'tenant-ksef', credentialSlot: mode, token: 'synthetic-token', contextNip: '5555555555' }) },
    numbers: createKsefNumberRepository(database),
    artifacts: createFiscalArtifactRepository(database),
    hash: createContentHash(),
    validator: { validate: async () => ok(undefined) },
    client: {
      validateCredentials: unexpectedTransport,
      openSession: unexpectedTransport,
      submitInvoice: unexpectedTransport,
      listSessionInvoices: unexpectedTransport,
      getInvoiceStatus: unexpectedTransport,
      downloadUpo: unexpectedTransport,
      verifyDuplicateOriginal: unexpectedTransport,
      closeSession: unexpectedTransport,
    },
  },
});

describe('controlled KSeF send persistence', () => {
  it('requests and concurrently sends with database-backed credentials on a single-connection pool', async () => {
    const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 1, connectionTimeoutMillis: 2_000 });
    try {
      const database = drizzle(pool, { schema });
      const deps = invoiceDeps(database);
      if (deps.ksef === undefined) throw new Error('Expected KSeF dependencies');
      deps.ksef.credentials = createKsefCredentialResolver(createTenantSecretResolver(deps.tenantSecrets, deps.secretCrypto));
      for (const [key, value] of [['ksef.token', 'synthetic-token'], ['ksef.contextNip', '5555555555']] as const) {
        await deps.tenantSecrets.upsert('tenant-ksef', {
          id: crypto.randomUUID(), tenantId: 'tenant-ksef', key, ciphertext: value,
          iv: 'iv', authTag: 'tag', maskedPreview: 'masked', updatedAt: now,
        });
      }
      await database.update(tenants).set({ invoicingProvider: 'ksef', ksefSubmissionMode: 'manual',
        invoiceVatRatePercent: 23, invoiceSellerName: 'Sample seller', invoiceSellerAddress: 'Sample Street 1' })
        .where(eq(tenants.id, 'tenant-ksef'));
      expect(await requestInvoice(ownerContext, 'order-24', deps)).toMatchObject({ ok: true, value: { ksef: { state: 'held' } } });
      const results = await Promise.all([
        sendInvoice(ownerContext, 'order-24', deps),
        sendInvoice(ownerContext, 'order-24', deps),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0]).toMatchObject({ ok: true, value: { ksef: { state: 'queued' } } });
      expect(await database.select().from(ksefNumberAllocations).where(eq(ksefNumberAllocations.orderId, 'order-24'))).toHaveLength(1);
      await database.update(tenants).set({ ksefSubmissionMode: 'automatic' }).where(eq(tenants.id, 'tenant-ksef'));
      expect(await requestInvoice(ownerContext, 'order-25', deps)).toMatchObject({ ok: true, value: { ksef: { state: 'queued' } } });
      await deps.tenantSecrets.delete('tenant-ksef', 'ksef.token');
      expect(await sendInvoice(ownerContext, 'order-24', deps)).toEqual(results[0]);
    } finally {
      await pool.end();
    }
  });

  it('holds without artifacts and freezes one number under concurrent sends', async () => {
    await db.update(tenants).set({ invoicingProvider: 'ksef', ksefSubmissionMode: 'manual',
      invoiceVatRatePercent: 23, invoiceSellerName: 'Sample seller', invoiceSellerAddress: 'Sample Street 1' })
      .where(eq(tenants.id, 'tenant-ksef'));
    const deps = invoiceDeps();
    const held = await requestInvoice(ownerContext, 'order-21', deps);
    expect(held).toMatchObject({ ok: true, value: { status: 'requested', invoiceNumber: null,
      ksef: { state: 'held', p2: null, issueDate: null, xmlArtifactKey: null } } });
    expect(await db.select().from(ksefNumberAllocations).where(eq(ksefNumberAllocations.orderId, 'order-21'))).toEqual([]);
    if (!held.ok) throw new Error('Expected held invoice');
    expect(await db.select().from(fiscalArtifacts).where(eq(fiscalArtifacts.invoiceId, held.value.id))).toEqual([]);
    expect(await db.select().from(ksefSubmissionJobs).where(eq(ksefSubmissionJobs.invoiceId, held.value.id))).toEqual([]);
    await db.update(tenants).set({ ksefSubmissionMode: 'automatic' }).where(eq(tenants.id, 'tenant-ksef'));
    expect(await requestInvoice(ownerContext, 'order-21', deps)).toMatchObject({ ok: true, value: { ksef: { state: 'held' } } });
    deps.clock = { nowIso: () => '2026-07-28T10:00:00.000Z' };
    const results = await Promise.all([sendInvoice(ownerContext, 'order-21', deps), sendInvoice(ownerContext, 'order-21', deps)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ ok: true, value: { id: held.value.id, status: 'queued',
      ksef: { issueDate: '2026-07-28', state: 'queued' } } });
    expect(await db.select().from(ksefNumberAllocations).where(eq(ksefNumberAllocations.orderId, 'order-21'))).toHaveLength(1);
    expect(await db.select().from(fiscalArtifacts).where(eq(fiscalArtifacts.invoiceId, held.value.id))).toHaveLength(1);
    expect(await db.select().from(ksefSubmissionJobs).where(eq(ksefSubmissionJobs.invoiceId, held.value.id))).toHaveLength(1);
    const events = await db.select().from(invoiceEvents).where(eq(invoiceEvents.invoiceId, held.value.id));
    expect(events.filter((event) => event.type === 'frozen')).toMatchObject([
      { meta: { actorId: 'owner-ksef' }, occurredAt: '2026-07-28T10:00:00.000Z' },
    ]);
    const listed = await createOrderRepository(db).list('tenant-ksef', { page: 1, pageSize: 100 });
    expect(listed.orders.find((order) => order.id === 'order-21')?.invoice).toMatchObject({ id: held.value.id, ksef: { state: 'queued' } });
  });

  it('isolates TEST numbering and rolls back failed XML validation including allocation', async () => {
    const before = await db.select().from(ksefNumberSequences).where(eq(ksefNumberSequences.environment, 'production'));
    const deps = invoiceDeps();
    await db.update(orders).set({ mode: 'test' }).where(eq(orders.id, 'order-22'));
    expect(await requestInvoice(ownerContext, 'order-22', deps)).toMatchObject({ ok: true,
      value: { invoiceNumber: 'FV/2026/000001', ksef: { environment: 'test', credentialMode: 'test' } } });
    expect(await db.select().from(ksefNumberSequences).where(eq(ksefNumberSequences.environment, 'production'))).toEqual(before);
    if (deps.ksef === undefined) throw new Error('Expected KSeF dependencies');
    deps.ksef.validator = { validate: async () => err(validation('Synthetic invalid XML')) };
    expect(await requestInvoice(ownerContext, 'order-23', deps)).toMatchObject({ ok: false });
    expect(await db.select().from(ksefNumberSequences).where(eq(ksefNumberSequences.environment, 'production'))).toEqual(before);
    expect(await db.select().from(ksefNumberAllocations).where(eq(ksefNumberAllocations.orderId, 'order-23'))).toEqual([]);
    expect(await deps.invoices.findCurrentByOrder('tenant-ksef', 'order-23')).toBeNull();
  });
});
