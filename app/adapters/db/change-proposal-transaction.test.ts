import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import { err, ok, validation, type Identity } from '#core/domain/index.js';
import {
  adjustProductStock,
  createProduct,
  createProductPrice,
  deactivateProductPrice,
  deleteProductDraft,
  enableProductStock,
  publishProduct,
  setProductStockThreshold,
  storageWithDeletesAfterCommit,
  unpublishProduct,
  updateProduct,
  type Ctx,
  type StorageProvider,
} from '#core/server/index.js';

import { CHANGE_PROPOSAL_BOUNDS, type ChangeProposalBounds } from './change-proposal-bounds.js';
import { createChangeProposalTransaction } from './change-proposal-transaction.js';
import { closeDb, createDb, type Db } from './client.js';
import { createTenantSecretRepository } from './repositories.js';
import { productDownloadAssets, productPrices, products, productStock, stockEvents, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const TENANT = 't-proposal-transaction';
const NOW = '2026-01-01T00:00:00.000Z';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let sequence = 0;
const deps = { ids: { nextId: () => `id-${String(++sequence)}` }, clock: { nowIso: () => NOW } };

const owner: Identity = {
  userId: 'user-owner', email: 'owner@example.test', name: 'Owner', emailVerified: true, tenantAccess: 'staff',
  tenantId: TENANT, tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner', memberId: null, image: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
};
const ownerCtx: Ctx = { identity: owner };

const logger = () => ({ error: vi.fn<(message: string) => void>() });

const secretCrypto = createSecretCrypto(Buffer.alloc(32, 9).toString('base64'));

const realSecretResolverOver = (connection: Db) => createTenantSecretResolver(createTenantSecretRepository(connection), secretCrypto);

const transactionOf = (log = logger(), db: Db = database.db, bounds: ChangeProposalBounds = CHANGE_PROPOSAL_BOUNDS) =>
  createChangeProposalTransaction(db, log, realSecretResolverOver, bounds);

const QUICK: ChangeProposalBounds = { lockWaitMs: 100, dryRunStatementMs: 100, approvalStatementMs: 100 };

const lockWaiters = async (observer: pg.Client): Promise<number> => {
  const waiting = await observer.query<{ count: number }>(
    "select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
  );
  return waiting.rows[0]?.count ?? 0;
};

const untilSomeoneWaitsOnALock = async (observer: pg.Client): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (await lockWaiters(observer) === 0) {
    if (Date.now() > deadline) throw new Error('No session started waiting on a lock');
  }
};

const connectedClient = async (): Promise<pg.Client> => {
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  return client;
};

const unusableStorage = (): StorageProvider => {
  const refuse = () => { throw new Error('Storage must not be reached in this test'); };
  return {
    delete: refuse, objectUrl: refuse, list: refuse, getObject: refuse, putObject: refuse, probe: refuse,
    probeCors: refuse, presignPut: refuse, presignGet: refuse, head: refuse, healthcheck: refuse, test: refuse,
  };
};

const insertProduct = async (id: string, values: { published?: boolean; everPublished?: boolean } = {}) => {
  await database.db.insert(products).values({
    id, tenantId: TENANT, slug: id, title: id, type: 'course', published: values.published ?? false,
    everPublished: values.everPublished ?? false, description: '', priceCents: 0, currency: 'EUR', createdAt: NOW,
  });
};

const productIds = async (): Promise<string[]> =>
  (await database.db.select({ slug: products.slug }).from(products).where(eq(products.tenantId, TENANT))).map(({ slug }) => slug).sort();

const priceCount = async (): Promise<number> =>
  (await database.db.select().from(productPrices).where(eq(productPrices.tenantId, TENANT))).length;

const contentVersion = async (): Promise<number | undefined> =>
  (await database.db.select({ version: tenants.contentVersion }).from(tenants).where(eq(tenants.id, TENANT)))[0]?.version;

beforeAll(async () => {
  database = await createTestDatabase('together_change_proposal_tx', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values({ id: TENANT, slug: 'acme', name: 'Acme', createdAt: NOW });
});

afterAll(async () => { await database?.close(); });

beforeEach(async () => {
  await database.db.delete(productPrices);
  await database.db.delete(products);
  await insertProduct('published', { published: true, everPublished: true });
});

const priceInput = { productId: 'published', kind: 'one_time' as const, amountCents: 1500, currency: 'EUR' };

describe('change proposal transaction run', () => {
  it('commits an ok result and runs its deferred effects after COMMIT', async () => {
    const seenByEffect: number[] = [];
    const transaction = transactionOf();
    const versionBefore = await contentVersion();

    const result = await transaction.run(TENANT, async ({ repositories, afterCommit }) => {
      const created = await createProductPrice(ownerCtx, priceInput, { ...repositories, ...deps });
      afterCommit.defer(async () => { seenByEffect.push(await priceCount()); });
      expect(seenByEffect).toEqual([]);
      return created;
    });

    expect(result).toMatchObject({ ok: true, value: { productId: 'published', amountCents: 1500 } });
    expect(seenByEffect).toEqual([1]);
    expect(await priceCount()).toBe(1);
    expect(await contentVersion()).toBe((versionBefore ?? 0) + 1);
  });

  it('rolls back every write of an error result and drops its effects', async () => {
    const effect = vi.fn(async () => undefined);
    const transaction = transactionOf();
    const versionBefore = await contentVersion();

    const result = await transaction.run(TENANT, async ({ repositories, afterCommit }) => {
      const created = await createProductPrice(ownerCtx, priceInput, { ...repositories, ...deps });
      expect(created.ok).toBe(true);
      afterCommit.defer(effect);
      return err(validation('Rejected after the write'));
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'validation', message: 'Rejected after the write' } });
    expect(effect).not.toHaveBeenCalled();
    expect(await priceCount()).toBe(0);
    expect(await contentVersion()).toBe(versionBefore);
  });

  it('rolls back and rethrows an infrastructure failure without running effects', async () => {
    const effect = vi.fn(async () => undefined);
    const transaction = transactionOf();

    await expect(transaction.run(TENANT, async ({ repositories, afterCommit }) => {
      await createProductPrice(ownerCtx, priceInput, { ...repositories, ...deps });
      afterCommit.defer(effect);
      throw new Error('connection lost');
    })).rejects.toThrow('connection lost');

    expect(effect).not.toHaveBeenCalled();
    expect(await priceCount()).toBe(0);
  });

  it('logs a failed effect after COMMIT, keeps the result and runs the remaining effects', async () => {
    const log = logger();
    const later = vi.fn(async () => undefined);
    const transaction = transactionOf(log);

    const result = await transaction.run(TENANT, async ({ afterCommit }) => {
      afterCommit.defer(async () => { throw new Error('storage unavailable'); });
      afterCommit.defer(later);
      return ok('done');
    });

    expect(result).toEqual({ ok: true, value: 'done' });
    expect(later).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('storage unavailable'));
  });

  it('refuses an effect deferred after the transaction ended', async () => {
    const transaction = transactionOf();
    let keep: ((effect: () => Promise<void>) => void) | null = null;
    await transaction.run(TENANT, async ({ afterCommit }) => {
      keep = (effect) => { afterCommit.defer(effect); };
      return ok(null);
    });
    expect(() => keep?.(async () => undefined)).toThrow(/after its change proposal transaction ended/u);
  });
});

describe('change proposal transaction dry run', () => {
  it('returns the live result and leaves no row, no content-version bump and no effect behind', async () => {
    const effect = vi.fn(async () => undefined);
    const transaction = transactionOf();
    const versionBefore = await contentVersion();

    const result = await transaction.dryRun(TENANT, async ({ repositories, afterCommit }) => {
      const created = await createProductPrice(ownerCtx, priceInput, { ...repositories, ...deps });
      afterCommit.defer(effect);
      expect(await repositories.prices.listByProduct(TENANT, 'published')).toHaveLength(1);
      return created;
    });

    expect(result).toMatchObject({ ok: true, value: { amountCents: 1500 } });
    expect(effect).not.toHaveBeenCalled();
    expect(await priceCount()).toBe(0);
    expect(await contentVersion()).toBe(versionBefore);
  });

  it('turns a repository\'s own transaction into a savepoint that the dry run discards', async () => {
    await insertProduct('draft');
    const transaction = transactionOf();

    const result = await transaction.dryRun(TENANT, async ({ repositories }) =>
      ok(await repositories.productDrafts.deleteDraft(TENANT, 'draft')));

    expect(result).toEqual({ ok: true, value: { kind: 'deleted', assets: [] } });
    expect(await productIds()).toEqual(['draft', 'published']);
  });

  it('runs all ten catalogue use-cases over transaction-bound repositories and leaves nothing behind', async () => {
    await insertProduct('draft');
    const storage = unusableStorage();
    const transaction = transactionOf();
    const versionBefore = await contentVersion();

    const result = await transaction.dryRun(TENANT, async ({ repositories, afterCommit, secretResolver }) => {
      const scoped = { ...repositories, ...deps };
      const steps: Array<{ ok: boolean }> = [];
      const product = await createProduct(ownerCtx, { title: 'Mug', slug: 'mug', type: 'physical', priceCents: 0 }, scoped);
      if (!product.ok) return product;
      const productId = product.value.id;
      const price = await createProductPrice(ownerCtx, { productId, kind: 'one_time', amountCents: 900, currency: 'EUR' }, scoped);
      if (!price.ok) return price;
      steps.push(
        await updateProduct(ownerCtx, { id: productId, title: 'Big mug' }, scoped),
        await publishProduct(ownerCtx, { id: productId }, scoped),
        await unpublishProduct(ownerCtx, { id: productId }, scoped),
        await enableProductStock(ownerCtx, { productId, onHand: 3 }, scoped),
        await adjustProductStock(ownerCtx, { productId, delta: 2, reason: 'Delivery' }, scoped),
        await setProductStockThreshold(ownerCtx, { productId, lowStockThreshold: 1 }, scoped),
        await deactivateProductPrice(ownerCtx, { id: price.value.id }, scoped),
        await deleteProductDraft(ownerCtx, { productId: 'draft' }, {
          productDrafts: repositories.productDrafts,
          storage: storageWithDeletesAfterCommit(storage, afterCommit, logger()),
          secretResolver,
          logger: logger(),
        }),
      );
      return ok(steps.map((step) => step.ok));
    });

    expect(result).toEqual({ ok: true, value: Array.from({ length: 8 }, () => true) });
    expect(await productIds()).toEqual(['draft', 'published']);
    expect(await priceCount()).toBe(0);
    expect(await database.db.select().from(productStock).where(eq(productStock.tenantId, TENANT))).toEqual([]);
    expect(await contentVersion()).toBe(versionBefore);
  });

  it('returns a live domain error unchanged', async () => {
    const transaction = transactionOf();
    const result = await transaction.dryRun(TENANT, async ({ repositories }) =>
      createProductPrice(ownerCtx, { ...priceInput, productId: 'missing' }, { ...repositories, ...deps }));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('change proposal transaction savepoints', () => {
  it('rolls back a failed savepoint and its effects while the outer transaction commits', async () => {
    const outerEffect = vi.fn(async () => undefined);
    const innerEffect = vi.fn(async () => undefined);
    const transaction = transactionOf();

    const result = await transaction.run(TENANT, async (scope) => {
      await insertVia(scope, 'outer');
      scope.afterCommit.defer(outerEffect);
      const inner = await scope.savepoint(async (nested) => {
        await insertVia(nested, 'inner');
        nested.afterCommit.defer(innerEffect);
        return err(validation('Inner operation refused'));
      });
      expect(inner).toMatchObject({ ok: false, error: { message: 'Inner operation refused' } });
      return ok(null);
    });

    expect(result.ok).toBe(true);
    expect(await productIds()).toEqual(['outer', 'published']);
    expect(outerEffect).toHaveBeenCalledOnce();
    expect(innerEffect).not.toHaveBeenCalled();
  });

  it('keeps a successful savepoint\'s writes and runs its effects only after the outer COMMIT', async () => {
    const order: string[] = [];
    const transaction = transactionOf();

    await transaction.run(TENANT, async (scope) => {
      const inner = await scope.savepoint(async (nested) => {
        await insertVia(nested, 'inner');
        nested.afterCommit.defer(async () => { order.push('inner effect'); });
        return ok(null);
      });
      expect(inner.ok).toBe(true);
      order.push('outer body');
      return ok(null);
    });

    expect(order).toEqual(['outer body', 'inner effect']);
    expect(await productIds()).toEqual(['inner', 'published']);
  });

  it('drops a successful savepoint when the outer transaction rolls back', async () => {
    const innerEffect = vi.fn(async () => undefined);
    const transaction = transactionOf();

    const result = await transaction.run(TENANT, async (scope) => {
      await scope.savepoint(async (nested) => {
        await insertVia(nested, 'inner');
        nested.afterCommit.defer(innerEffect);
        return ok(null);
      });
      return err(validation('Outer operation refused'));
    });

    expect(result.ok).toBe(false);
    expect(innerEffect).not.toHaveBeenCalled();
    expect(await productIds()).toEqual(['published']);
  });

  it('nests savepoints inside savepoints', async () => {
    const transaction = transactionOf();

    await transaction.run(TENANT, async (scope) => scope.savepoint(async (middle) => {
      await insertVia(middle, 'middle');
      await middle.savepoint(async (inner) => {
        await insertVia(inner, 'inner');
        return err(validation('Innermost refused'));
      });
      return ok(null);
    }));

    expect(await productIds()).toEqual(['middle', 'published']);
  });
});

const insertVia = async (
  scope: Parameters<Parameters<ReturnType<typeof createChangeProposalTransaction>['run']>[1]>[0],
  id: string,
): Promise<void> => {
  const created = await createProduct(ownerCtx, { title: id, slug: id, priceCents: 0 }, { ...scope.repositories, ...deps });
  if (!created.ok) throw new Error(created.error.message);
  await scope.repositories.products.findById(TENANT, created.value.id).then((product) => {
    if (product === null) throw new Error(`Product ${id} is not visible inside its transaction`);
  });
};

describe('change proposal transaction connections and locks', () => {
  it('dry-runs a draft deletion with the real secret resolver on a one-connection pool', async () => {
    const configuration = { provider: 'aws_s3', endpoint: 'https://storage.example.test', region: 'auto', bucket: 'downloads', accessKeyId: 'key-id', secretAccessKey: 'key-secret' };
    await createTenantSecretRepository(database.db).upsert(TENANT, {
      id: 'storage-configuration', tenantId: TENANT, key: 's3.configuration', ...secretCrypto.encrypt(JSON.stringify(configuration)),
      maskedPreview: 'configured', updatedAt: NOW,
    });
    await insertProduct('draft-with-file');
    await database.db.insert(productDownloadAssets).values({
      id: 'asset-draft', tenantId: TENANT, productId: 'draft-with-file', lineageId: 'lineage-draft', fileName: 'guide.pdf',
      contentType: 'application/pdf', sizeBytes: 10, storageKey: 'downloads/guide.pdf', status: 'ready', createdAt: NOW,
    });
    const deletes: string[] = [];
    const storage: StorageProvider = {
      ...unusableStorage(),
      objectUrl: (stored, key) => new URL(`${stored.endpoint}/${stored.bucket}/${key}`),
      delete: async (input) => {
        deletes.push(`${input.accessKeyId} ${input.url}`);
        return ok({ deleted: true });
      },
    };
    const single = createDb('node-postgres', database.url, { max: 1, connectionTimeoutMillis: 2_000 });
    const log = logger();
    try {
      const transaction = transactionOf(log, single);
      const run = (operation: 'dryRun' | 'run') => transaction[operation](TENANT, async ({ repositories, afterCommit, secretResolver }) =>
        deleteProductDraft(ownerCtx, { productId: 'draft-with-file' }, {
          productDrafts: repositories.productDrafts,
          storage: storageWithDeletesAfterCommit(storage, afterCommit, log),
          secretResolver,
          logger: log,
        }));

      expect(await run('dryRun')).toEqual({ ok: true, value: { deleted: true } });
      expect(deletes).toEqual([]);
      expect(await productIds()).toContain('draft-with-file');

      expect(await run('run')).toEqual({ ok: true, value: { deleted: true } });
      expect(deletes).toEqual(['key-id https://storage.example.test/downloads/downloads/guide.pdf']);
      expect(log.error).not.toHaveBeenCalled();
    } finally {
      await closeDb(single);
    }
  });

  it('completes a dry run beside a live stock adjustment that holds the stock row and has not written its event yet', async () => {
    await database.db.insert(productStock).values({ tenantId: TENANT, productId: 'published', onHand: 10, reserved: 0, updatedAt: NOW });
    const live = await connectedClient();
    const observer = await connectedClient();
    try {
      await live.query('begin');
      await live.query('select on_hand from product_stock where tenant_id = $1 and product_id = $2 for update', [TENANT, 'published']);
      await live.query('update product_stock set on_hand = on_hand + 1 where tenant_id = $1 and product_id = $2', [TENANT, 'published']);

      const dryRun = transactionOf().dryRun(TENANT, async ({ repositories }) =>
        ok(await repositories.targets.lock(TENANT, { kind: 'product', id: 'published' })));
      await untilSomeoneWaitsOnALock(observer);

      await live.query(
        "insert into stock_events (tenant_id, product_id, type, quantity, reference, occurred_at) values ($1, $2, 'adjusted', 1, '{}'::jsonb, $3)",
        [TENANT, 'published', NOW],
      );
      await live.query('commit');

      expect(await dryRun).toEqual({ ok: true, value: true });
      expect(await database.db.select({ quantity: stockEvents.quantity }).from(stockEvents)
        .where(and(eq(stockEvents.tenantId, TENANT), eq(stockEvents.productId, 'published')))).toEqual([{ quantity: 1 }]);
    } finally {
      await live.end();
      await observer.end();
      await database.db.delete(stockEvents).where(eq(stockEvents.tenantId, TENANT));
      await database.db.delete(productStock).where(eq(productStock.tenantId, TENANT));
    }
  }, 30_000);

  it('answers unavailable with a retry-after when the workspace lock stays held', async () => {
    const holder = await connectedClient();
    try {
      await holder.query('begin');
      await holder.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`change-proposal-transaction:${TENANT}`]);
      const operation = vi.fn(async () => ok(null));

      const result = await transactionOf(logger(), database.db, QUICK).dryRun(TENANT, operation);

      expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'unavailable', details: { retryAfterSeconds: 5 } }) });
      expect(operation).not.toHaveBeenCalled();
    } finally {
      await holder.query('rollback');
      await holder.end();
    }
    expect(await transactionOf().dryRun(TENANT, async () => ok('free'))).toEqual({ ok: true, value: 'free' });
  }, 30_000);

  it('answers busy without running the operation while another dry run of the same group holds its lock', async () => {
    const holder = await connectedClient();
    try {
      await holder.query('begin');
      await holder.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`change-proposal-group-dry-run:${TENANT}:group-1`]);
      const operation = vi.fn(async () => ok(null));

      expect(await transactionOf(logger(), database.db, QUICK).dryRun(TENANT, operation, { groupId: 'group-1' }))
        .toEqual({ ok: false, error: expect.objectContaining({ code: 'unavailable' }) });
      expect(operation).not.toHaveBeenCalled();
      expect(await transactionOf(logger(), database.db, QUICK).dryRun(TENANT, async () => ok('other group'), { groupId: 'group-2' }))
        .toEqual({ ok: true, value: 'other group' });
    } finally {
      await holder.query('rollback');
      await holder.end();
    }
  }, 30_000);

  it.each(['run', 'dryRun'] as const)('answers busy and keeps nothing when a statement of %s runs past its time bound', async (mode) => {
    const holder = await connectedClient();
    try {
      await holder.query('begin');
      await holder.query('select id from products where tenant_id = $1 and id = $2 for update', [TENANT, 'published']);
      const slow: ChangeProposalBounds = { lockWaitMs: 10_000, dryRunStatementMs: 100, approvalStatementMs: 100 };

      expect(await transactionOf(logger(), database.db, slow)[mode](TENANT, async ({ repositories }) =>
        ok(await repositories.targets.lock(TENANT, { kind: 'product', id: 'published' }))))
        .toEqual({ ok: false, error: expect.objectContaining({ code: 'unavailable', details: { retryAfterSeconds: 5 } }) });
    } finally {
      await holder.query('rollback');
      await holder.end();
    }
  }, 30_000);
});
