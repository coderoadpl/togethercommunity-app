import { sql } from 'drizzle-orm';

import type { AppError, Result } from '#core/domain/index.js';
import { serializeErrorChain } from '#core/server/log-safety.js';
import type {
  ChangeProposalPostCommitEffects,
  ChangeProposalRepositories,
  ChangeProposalTransaction,
  ChangeProposalTransactionScope,
} from '#core/server/index.js';

import {
  createChangeProposalEventRepository,
  createChangeProposalRepository,
  createChangeProposalTargetLocks,
} from './change-proposals.js';
import type { Db } from './client.js';
import { createProductDraftRepository } from './product-drafts.js';
import {
  createProductDownloadAssetRepository,
  createProductPriceRepository,
  createProductRepository,
  createSpaceRepository,
  createTenantRepository,
} from './repositories.js';
import { createStockRepository } from './stock.js';

type PostCommitEffect = () => Promise<void>;

type ScopedOperation<T> = (scope: ChangeProposalTransactionScope) => Promise<Result<T, AppError>>;

const repositoriesOver = (tx: Db): ChangeProposalRepositories => {
  const tenants = createTenantRepository(tx);
  const downloadAssets = createProductDownloadAssetRepository(tx);
  const spaces = createSpaceRepository(tx);
  return {
    products: createProductRepository(tx),
    prices: createProductPriceRepository(tx),
    tenants: { findSettings: (tenantId) => tenants.findSettings(tenantId) },
    downloadAssets: { listReadyByProduct: (tenantId, productId) => downloadAssets.listReadyByProduct(tenantId, productId) },
    spaces: { list: (tenantId, options) => spaces.list(tenantId, options) },
    stock: createStockRepository(tx),
    productDrafts: createProductDraftRepository(tx),
    changeProposals: createChangeProposalRepository(tx),
    changeProposalEvents: createChangeProposalEventRepository(tx),
    targets: createChangeProposalTargetLocks(tx),
  };
};

const collectorInto = (effects: PostCommitEffect[], isOpen: () => boolean): ChangeProposalPostCommitEffects => ({
  defer: (effect) => {
    if (!isOpen()) throw new Error('A post-commit effect was deferred after its change proposal transaction ended');
    effects.push(effect);
  },
});

const rollingBackErrors = async <T>(
  executor: Db,
  operation: (tx: Db) => Promise<Result<T, AppError>>,
  rollBackAlways = false,
): Promise<Result<T, AppError>> => {
  let settled: Result<T, AppError> | null = null;
  try {
    return await executor.transaction(async (tx) => {
      const result = await operation(tx);
      // Drizzle rolls back by throwing, so keep the result before aborting the transaction or savepoint.
      if (!result.ok || rollBackAlways) {
        settled = result;
        tx.rollback();
      }
      return result;
    });
  } catch (cause) {
    if (settled !== null) return settled;
    throw cause;
  }
};

const scopeOver = (tx: Db, effects: PostCommitEffect[], isOpen: () => boolean): ChangeProposalTransactionScope => ({
  repositories: repositoriesOver(tx),
  afterCommit: collectorInto(effects, isOpen),
  savepoint: async (operation) => {
    const nested: PostCommitEffect[] = [];
    let savepointOpen = true;
    const result = await rollingBackErrors(tx, (savepointTx) =>
      operation(scopeOver(savepointTx, nested, () => savepointOpen && isOpen())))
      .finally(() => { savepointOpen = false; });
    if (result.ok) effects.push(...nested);
    return result;
  },
});

const lockWorkspace = async (tx: Db, tenantId: string): Promise<void> => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`change-proposal-transaction:${tenantId}`}, 0))`);
};

export const createChangeProposalTransaction = (
  db: Db,
  logger: { error(message: string): void },
): ChangeProposalTransaction => {
  const runScoped = async <T>(tenantId: string, operation: ScopedOperation<T>, rollBackAlways: boolean) => {
    const effects: PostCommitEffect[] = [];
    let open = true;
    const result = await rollingBackErrors(db, async (tx) => {
      await lockWorkspace(tx, tenantId);
      return operation(scopeOver(tx, effects, () => open));
    }, rollBackAlways).finally(() => { open = false; });
    return { result, effects: result.ok && !rollBackAlways ? effects : [] };
  };

  return {
    run: async (tenantId, operation) => {
      const { result, effects } = await runScoped(tenantId, operation, false);
      for (const effect of effects) {
        try {
          await effect();
        } catch (cause) {
          logger.error(`[change-proposal] post-commit effect failed tenant=${tenantId}: ${serializeErrorChain(cause)}`);
        }
      }
      return result;
    },
    dryRun: async (tenantId, operation) => (await runScoped(tenantId, operation, true)).result,
  };
};
