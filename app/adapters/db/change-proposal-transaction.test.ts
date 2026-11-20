import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { err, ok, validation, type Identity } from '#core/domain/index.js';
import { createProduct, createProductPrice, type Ctx } from '#core/server/index.js';

import { createChangeProposalTransaction } from './change-proposal-transaction.js';
import { productPrices, products, tenants } from './schema.js';
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
    const transaction = createChangeProposalTransaction(database.db, logger());
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
    const transaction = createChangeProposalTransaction(database.db, logger());
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
    const transaction = createChangeProposalTransaction(database.db, logger());

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
    const transaction = createChangeProposalTransaction(database.db, log);

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
    const transaction = createChangeProposalTransaction(database.db, logger());
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
    const transaction = createChangeProposalTransaction(database.db, logger());
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
    const transaction = createChangeProposalTransaction(database.db, logger());

    const result = await transaction.dryRun(TENANT, async ({ repositories }) =>
      ok(await repositories.productDrafts.deleteDraft(TENANT, 'draft')));

    expect(result).toEqual({ ok: true, value: { kind: 'deleted', assets: [] } });
    expect(await productIds()).toEqual(['draft', 'published']);
  });

  it('returns a live domain error unchanged', async () => {
    const transaction = createChangeProposalTransaction(database.db, logger());
    const result = await transaction.dryRun(TENANT, async ({ repositories }) =>
      createProductPrice(ownerCtx, { ...priceInput, productId: 'missing' }, { ...repositories, ...deps }));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('change proposal transaction savepoints', () => {
  it('rolls back a failed savepoint and its effects while the outer transaction commits', async () => {
    const outerEffect = vi.fn(async () => undefined);
    const innerEffect = vi.fn(async () => undefined);
    const transaction = createChangeProposalTransaction(database.db, logger());

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
    const transaction = createChangeProposalTransaction(database.db, logger());

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
    const transaction = createChangeProposalTransaction(database.db, logger());

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
    const transaction = createChangeProposalTransaction(database.db, logger());

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
