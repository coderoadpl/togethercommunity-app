import { changeProposalsBusy, err, type AppError, type Result } from '#core/domain/index.js';
import { serializeErrorChain } from '#core/server/log-safety.js';
import type {
  ChangeProposalPostCommitEffects,
  ChangeProposalRepositories,
  ChangeProposalTransaction,
  ChangeProposalTransactionScope,
  TenantSecretResolver,
} from '#core/server/index.js';

import { boundedAdvisoryLock, lockWaitMs } from './bounded-advisory-lock.js';
import {
  createChangeProposalEventRepository,
  createChangeProposalRepository,
  createChangeProposalTargetLocks,
} from './change-proposals.js';
import type { Db } from './client.js';
import { deadlockDetected, lockNotAvailable } from './pg-errors.js';
import { createProductDraftRepository } from './product-drafts.js';
import {
  createProductDownloadAssetRepository,
  createProductPriceRepository,
  createProductRepository,
  createSpaceRepository,
  createTenantRepository,
} from './repositories.js';
import { createSalesLinkRepository } from './sales-links.js';
import { createStockRepository } from './stock.js';

type PostCommitEffect = () => Promise<void>;

type ScopedOperation<T> = (scope: ChangeProposalTransactionScope) => Promise<Result<T, AppError>>;

const repositoriesOver = (tx: Db, waitMs: number): ChangeProposalRepositories => {
  const tenants = createTenantRepository(tx);
  const downloadAssets = createProductDownloadAssetRepository(tx);
  const spaces = createSpaceRepository(tx);
  return {
    products: createProductRepository(tx),
    prices: createProductPriceRepository(tx),
    tenants: {
      findSettings: (tenantId) => tenants.findSettings(tenantId),
      changeSettings: (tenantId, change) => tenants.changeSettings(tenantId, change),
    },
    downloadAssets: {
      listByProduct: (tenantId, productId) => downloadAssets.listByProduct(tenantId, productId),
      listReadyByProduct: (tenantId, productId) => downloadAssets.listReadyByProduct(tenantId, productId),
    },
    spaces: {
      list: (tenantId, options) => spaces.list(tenantId, options),
      findById: (tenantId, id) => spaces.findById(tenantId, id),
    },
    stock: createStockRepository(tx),
    productDrafts: createProductDraftRepository(tx),
    salesLinks: createSalesLinkRepository(tx),
    changeProposals: createChangeProposalRepository(tx, { lockWaitMs: waitMs }),
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

type SecretResolverOver = (executor: Db) => TenantSecretResolver;

const scopeOver = (
  tx: Db,
  waitMs: number,
  secretResolverOver: SecretResolverOver,
  effects: PostCommitEffect[],
  isOpen: () => boolean,
): ChangeProposalTransactionScope => ({
  repositories: repositoriesOver(tx, waitMs),
  secretResolver: secretResolverOver(tx),
  afterCommit: collectorInto(effects, isOpen),
  savepoint: async (operation) => {
    const nested: PostCommitEffect[] = [];
    let savepointOpen = true;
    const result = await rollingBackErrors(tx, (savepointTx) =>
      operation(scopeOver(savepointTx, waitMs, secretResolverOver, nested, () => savepointOpen && isOpen())))
      .finally(() => { savepointOpen = false; });
    if (result.ok) effects.push(...nested);
    return result;
  },
});

export const createChangeProposalTransaction = (
  db: Db,
  logger: { error(message: string): void },
  secretResolverOver: SecretResolverOver,
  options: { lockWaitMs?: number } = {},
): ChangeProposalTransaction => {
  const waitMs = lockWaitMs(options.lockWaitMs);
  const runScoped = async <T>(tenantId: string, operation: ScopedOperation<T>, rollBackAlways: boolean) => {
    const effects: PostCommitEffect[] = [];
    let open = true;
    try {
      const result = await rollingBackErrors(db, async (tx): Promise<Result<T, AppError>> => {
        if (!await boundedAdvisoryLock(tx, `change-proposal-transaction:${tenantId}`, { lockWaitMs: waitMs, lockWaitAfterMs: waitMs })) {
          return err(changeProposalsBusy());
        }
        return operation(scopeOver(tx, waitMs, secretResolverOver, effects, () => open));
      }, rollBackAlways).finally(() => { open = false; });
      return { result, effects: result.ok && !rollBackAlways ? effects : [] };
    } catch (cause) {
      // A lock wait that ran out or ended in a deadlock aborted the whole transaction, which has rolled back by now, so nothing was applied.
      if (lockNotAvailable(cause) || deadlockDetected(cause)) return { result: err<AppError>(changeProposalsBusy()), effects: [] };
      throw cause;
    }
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
