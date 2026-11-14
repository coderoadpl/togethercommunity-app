import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createContentHash } from '#adapters/crypto/content-hash.js';
import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import { createTenantOriginResolver } from '#core/server/tenant-url.js';
import { dispatchMetaCapi, getMetaCapiConfig, recordPublicMetaCapiConsent, type MetaCapiDispatchDeps } from '#core/server/usecases/meta-capi.js';
import { closeDb, createDb, type Db } from './client.js';
import { createMetaCapiRepository } from './meta-capi.js';
import { createTenantDirectory, createTenantDomainRepository, createTenantRepository, createTenantSecretRepository } from './repositories.js';
import { members, metaCapiConsentEvidence, metaCapiEvents, metaCapiOutbox, orders, products, tenants, tenantSecrets, user } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

type Decision = 'granted' | 'denied' | 'withdrawn';

const now = '2026-11-01T10:00:00.000Z';
const masterKey = Buffer.alloc(32, 7).toString('base64');
const request = { ip: '192.0.2.1', userAgent: 'Browser' };
let database: Awaited<ReturnType<typeof createTestDatabase>>;

const storeToken = async () => {
  await createTenantSecretRepository(database.db).upsert('workspace', { id: 'meta-capi-token', tenantId: 'workspace', key: 'analyticsMetaCapiAccessToken',
    ...createSecretCrypto(masterKey).encrypt('test-token'), maskedPreview: 'configured', updatedAt: now });
};

beforeAll(async () => {
  database = await createTestDatabase('together_meta_capi_pool', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values({ id: 'workspace', slug: 'workspace', name: 'Workspace', createdAt: now,
    analyticsMetaCapiEnabled: true, analyticsMetaPixelId: '1234567890', privacyUrl: 'https://example.org/privacy' });
  await storeToken();
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
  await database.db.insert(members).values({ id: 'buyer', tenantId: 'workspace', userId: 'buyer', email: 'buyer@example.org', createdAt: now });
  await database.db.insert(products).values({ id: 'book', tenantId: 'workspace', slug: 'book', type: 'digital_download', title: 'Book',
    description: '', priceCents: 9900, currency: 'PLN', published: true, createdAt: now });
});
afterAll(async () => { await database?.close(); });

type Failure = 'settings' | 'secret';

const rejectRead = () => Promise.reject(new Error('Workspace read failed'));

const workspaceReaders = (connection: Db, failing?: Failure) => {
  const tenantRepository = createTenantRepository(connection);
  return {
    tenants: failing === 'settings' ? { findSettings: rejectRead } : tenantRepository,
    secrets: failing === 'secret' ? { resolve: rejectRead } : createTenantSecretResolver(createTenantSecretRepository(connection), createSecretCrypto(masterKey)),
    resolveOrigin: createTenantOriginResolver({ tenants: tenantRepository, tenantDomains: createTenantDomainRepository(connection),
      appBaseUrl: 'https://example.org', baseDomain: 'example.org', singleTenantMode: false }),
  };
};

const productionDeps = (db: Db, options: { failing?: Failure; clock?: () => string } = {}) => {
  const pool = workspaceReaders(db, options.failing);
  const warn = vi.fn();
  const send = vi.fn<MetaCapiDispatchDeps['gateway']['send']>(async () => ({ ok: true, fbtraceId: 'trace' }));
  const deps: MetaCapiDispatchDeps = {
    repository: createMetaCapiRepository(db, (connection) => workspaceReaders(connection, options.failing), { warn }), tenants: pool.tenants, directory: createTenantDirectory(db),
    clock: { nowIso: options.clock ?? (() => now) }, hash: createContentHash(), secrets: pool.secrets, gateway: { send }, logger: { warn },
  };
  return { deps, send, warn };
};

const withPool = async <T>(max: number, run: (db: Db) => Promise<T>): Promise<T> => {
  const db = createDb('node-postgres', database.url, { max, connectionTimeoutMillis: 2_000 });
  try { return await run(db); } finally { await closeDb(db); }
};

const seedOrder = async (id: string) => {
  await database.db.insert(orders).values({ id, tenantId: 'workspace', memberId: 'buyer', productId: 'book', kind: 'one_time', status: 'paid', mode: 'live',
    amountCents: 9900, currency: 'PLN', provider: 'stripe', providerObjectIds: { checkoutSession: `cs_live_${id}` }, paidAt: now, createdAt: now });
  const sessionId = `cs_live_${id}`;
  const config = await getMetaCapiConfig('workspace', sessionId, productionDeps(database.db).deps);
  if (!config?.enabled) throw new Error('Meta consent must be available for the seeded order');
  return { sessionId, textVersion: config.textVersion };
};

const decide = (deps: MetaCapiDispatchDeps, order: { sessionId: string; textVersion: string }, decision: Decision) =>
  recordPublicMetaCapiConsent('workspace', { sessionId: order.sessionId, decision, textVersion: order.textVersion }, request, deps);

const storedOutcome = async (orderId: string) => {
  const row = (await database.db.select().from(orders).where(eq(orders.id, orderId)))[0];
  const evidence = await database.db.select({ decision: metaCapiConsentEvidence.decision }).from(metaCapiConsentEvidence)
    .where(eq(metaCapiConsentEvidence.orderId, orderId));
  const outbox = await database.db.select().from(metaCapiOutbox).where(eq(metaCapiOutbox.orderId, orderId));
  const events = await database.db.select({ status: metaCapiEvents.status }).from(metaCapiEvents)
    .where(and(eq(metaCapiEvents.tenantId, 'workspace'), eq(metaCapiEvents.transactionId, orderId)));
  return { consent: row?.metaCapiConsent, withdrawn: row?.metaCapiConsentWithdrawnAt !== null,
    evidence: evidence.map(({ decision }) => decision).sort(), pending: outbox.length, events: events.map(({ status }) => status) };
};

const serialOutcome = (decisions: Decision[]) => {
  const state = decisions.reduce<{ consent: 'undecided' | 'granted' | 'denied'; withdrawn: boolean; evidence: Decision[] }>((current, decision) => {
    if (current.withdrawn) return current;
    if (decision === 'withdrawn') return { ...current, withdrawn: true, evidence: [...current.evidence, decision] };
    return current.consent === 'undecided' ? { ...current, consent: decision, evidence: [...current.evidence, decision] } : current;
  }, { consent: 'undecided', withdrawn: false, evidence: [] });
  return { consent: state.consent, withdrawn: state.withdrawn, evidence: [...state.evidence].sort(),
    pending: state.consent === 'granted' && !state.withdrawn ? 1 : 0, events: state.consent === 'denied' || state.withdrawn ? ['blocked'] : [] };
};

const signal = () => {
  let fire = (): void => undefined;
  const fired = new Promise<void>((resolve) => { fire = () => { resolve(); }; });
  return { fired, fire: () => { fire(); } };
};

const workspaceChanges = {
  disabled: async () => { await database.db.update(tenants).set({ analyticsMetaCapiEnabled: false }).where(eq(tenants.id, 'workspace')); },
  tokenDeleted: async () => {
    await database.db.delete(tenantSecrets).where(and(eq(tenantSecrets.tenantId, 'workspace'), eq(tenantSecrets.key, 'analyticsMetaCapiAccessToken')));
  },
  textChanged: async () => { await database.db.update(tenants).set({ analyticsMetaCapiConsentHeading: 'Updated heading' }).where(eq(tenants.id, 'workspace')); },
};

const restoreWorkspace = async () => {
  await database.db.update(tenants).set({ analyticsMetaCapiEnabled: true, analyticsMetaCapiConsentHeading: null }).where(eq(tenants.id, 'workspace'));
  await storeToken();
};

const waitForOrderLock = () => vi.waitFor(async () => {
  const waiting = await database.db.execute(sql`SELECT pid FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%for update%'`);
  expect(waiting).toMatchObject({ rows: expect.arrayContaining([expect.objectContaining({ pid: expect.any(Number) })]) });
}, { timeout: 5_000 });

const orderings = <T>(items: T[]): T[][] => items.length <= 1 ? [items]
  : items.flatMap((item, index) => orderings([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));

describe('Meta CAPI transactions with the production origin resolver', () => {
  it('records a grant on a one-connection pool', async () => {
    const order = await seedOrder('poolgrant');
    const result = await withPool(1, async (db) => decide(productionDeps(db).deps, order, 'granted'));
    expect(result).toEqual({ ok: true, value: { consent: 'granted', withdrawnAt: null } });
    expect(await storedOutcome('poolgrant')).toEqual(serialOutcome(['granted']));
  });

  it('records a withdrawal on a one-connection pool', async () => {
    const order = await seedOrder('poolwithdraw');
    expect(await decide(productionDeps(database.db).deps, order, 'granted')).toMatchObject({ ok: true });
    const result = await withPool(1, async (db) => decide(productionDeps(db).deps, order, 'withdrawn'));
    expect(result).toEqual({ ok: true, value: { consent: 'granted', withdrawnAt: now } });
    expect(await storedOutcome('poolwithdraw')).toEqual(serialOutcome(['granted', 'withdrawn']));
  });

  it('completes a dispatch pass on a one-connection pool', async () => {
    const order = await seedOrder('pooldispatch');
    expect(await decide(productionDeps(database.db).deps, order, 'granted')).toMatchObject({ ok: true });
    const { send, warn } = await withPool(1, async (db) => {
      const harness = productionDeps(db);
      await dispatchMetaCapi(harness.deps);
      return harness;
    });
    expect(warn).not.toHaveBeenCalled();
    expect(send.mock.calls.map(([, input]) => input.payload.event_source_url)).toContain('https://workspace.example.org/checkout/book');
    expect((await storedOutcome('pooldispatch')).events).toEqual(['sent']);
  });

  it('settles as many concurrent decisions on one order as the pool has connections, as some serial order', async () => {
    const decisions: Decision[] = ['granted', 'denied', 'withdrawn'];
    const order = await seedOrder('poolrace');
    const results = await withPool(decisions.length, async (db) => {
      const { deps } = productionDeps(db);
      return Promise.allSettled(decisions.map((decision) => decide(deps, order, decision)));
    });
    expect(results).toEqual(decisions.map(() => ({ status: 'fulfilled', value: expect.objectContaining({ ok: true }) })));
    expect(orderings(decisions).map(serialOutcome)).toContainEqual(await storedOutcome('poolrace'));
  });

  it('settles more concurrent decisions on one order than the pool has connections, as some serial order', async () => {
    const decisions: Decision[] = ['granted', 'denied', 'withdrawn'];
    const order = await seedOrder('poolqueue');
    const results = await withPool(1, async (db) => {
      const { deps } = productionDeps(db);
      return Promise.allSettled(decisions.map((decision) => decide(deps, order, decision)));
    });
    expect(results).toEqual(decisions.map(() => ({ status: 'fulfilled', value: expect.objectContaining({ ok: true }) })));
    expect(orderings(decisions).map(serialOutcome)).toContainEqual(await storedOutcome('poolqueue'));
  });
});

describe('Meta CAPI workspace checks under the order lock', () => {
  it.each([
    ['disabled', 'Meta conversion consent is unavailable'],
    ['tokenDeleted', 'Meta conversion consent is unavailable'],
    ['textChanged', 'The consent text changed; reload before deciding'],
  ] as const)('refuses a grant when the workspace is %s while the decision waits for the order', async (change, message) => {
    const id = `locked${change.toLowerCase()}`;
    const order = await seedOrder(id);
    const held = signal();
    const release = signal();
    const holder = database.db.transaction(async (tx) => {
      await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, id)).for('update');
      held.fire();
      await release.fired;
    });
    await held.fired;
    try {
      const result = await withPool(1, async (db) => {
        const deciding = decide(productionDeps(db).deps, order, 'granted');
        await waitForOrderLock();
        await workspaceChanges[change]();
        release.fire();
        return deciding;
      });
      expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'validation', message }) });
      expect(await storedOutcome(id)).toEqual(serialOutcome([]));
    } finally {
      release.fire();
      await holder;
      await restoreWorkspace();
    }
  });

  it.each(['disabled', 'tokenDeleted'] as const)('blocks a job when the workspace is %s while the dispatch pass waits for the order', async (change) => {
    await database.db.delete(metaCapiOutbox);
    const id = `held${change.toLowerCase()}`;
    const order = await seedOrder(id);
    expect(await decide(productionDeps(database.db).deps, order, 'granted')).toMatchObject({ ok: true });
    const entered = signal();
    const release = signal();
    try {
      const { send } = await withPool(1, async (db) => {
        const harness = productionDeps(db);
        const { processNext } = harness.deps.repository;
        harness.deps.repository.processNext = async (...call) => {
          entered.fire();
          await release.fired;
          return processNext(...call);
        };
        const passing = dispatchMetaCapi(harness.deps);
        await entered.fired;
        await workspaceChanges[change]();
        release.fire();
        await passing;
        return harness;
      });
      expect(send).not.toHaveBeenCalled();
      expect((await storedOutcome(id)).events).toEqual(['blocked']);
    } finally {
      release.fire();
      await restoreWorkspace();
    }
  });

  it.each(['settings', 'secret'] as const)('retries a job whose workspace %s read fails and stores a failed event at the attempt limit', async (failing) => {
    await database.db.delete(metaCapiOutbox);
    const id = `failing${failing}`;
    const order = await seedOrder(id);
    expect(await decide(productionDeps(database.db).deps, order, 'granted')).toMatchObject({ ok: true });
    const pending = async () => database.db.select({ attempts: metaCapiOutbox.attempts, availableAt: metaCapiOutbox.availableAt })
      .from(metaCapiOutbox).where(eq(metaCapiOutbox.orderId, id));
    let time = now;
    const { send, warn } = await withPool(1, async (db) => {
      const harness = productionDeps(db, { failing, clock: () => time });
      await dispatchMetaCapi(harness.deps);
      expect(harness.warn.mock.calls).toEqual([['[meta-capi] job_processing_failed']]);
      expect((await pending()).map((row) => ({ ...row, availableAt: new Date(row.availableAt).toISOString() })))
        .toEqual([{ attempts: 1, availableAt: '2026-11-01T10:01:00.000Z' }]);
      for (const at of ['2026-11-01T10:01:00.000Z', '2026-11-01T10:03:00.000Z', '2026-11-01T10:07:00.000Z']) {
        time = at;
        await dispatchMetaCapi(harness.deps);
      }
      return harness;
    });
    expect(await pending()).toEqual([]);
    expect(await database.db.select({ status: metaCapiEvents.status, error: metaCapiEvents.error }).from(metaCapiEvents)
      .where(eq(metaCapiEvents.transactionId, id))).toEqual([{ status: 'failed', error: 'job_processing_failed' }]);
    expect(warn.mock.calls).toEqual(Array.from({ length: 4 }, () => ['[meta-capi] job_processing_failed']));
    expect(send).not.toHaveBeenCalled();
  });
});
