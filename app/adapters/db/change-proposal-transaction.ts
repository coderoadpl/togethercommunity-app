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
  boundStatementTime,
  changeProposalBounds,
  ranOutOfTime,
  type ChangeProposalBoundOptions,
  type ChangeProposalBounds,
} from './change-proposal-bounds.js';
import { createChangeProposalGroupRepository } from './change-proposal-groups.js';
import { createQuarantinedImageLocks } from './change-proposal-images.js';
import {
  createChangeProposalEventRepository,
  createChangeProposalRepository,
  createChangeProposalTargetLocks,
} from './change-proposals.js';
import type { Db } from './client.js';
import { createChangeProposalProductFiles, createKeyDownloadAttachRepository } from './key-download-files.js';
import { createProductDraftRepository } from './product-drafts.js';
import {
  createCourseLessonRepository,
  createCourseModuleRepository,
  createCourseRepository,
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

const repositoriesOver = (tx: Db, bounds: ChangeProposalBounds): ChangeProposalRepositories => {
  const tenants = createTenantRepository(tx);
  const downloadAssets = createProductDownloadAssetRepository(tx);
  const spaces = createSpaceRepository(tx);
  const courses = createCourseRepository(tx);
  const modules = createCourseModuleRepository(tx);
  const lessons = createCourseLessonRepository(tx);
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
    courses: { findByIds: (tenantId, ids) => courses.findByIds(tenantId, ids) },
    modules: {
      findByIds: (tenantId, ids) => modules.findByIds(tenantId, ids),
      list: (tenantId) => modules.list(tenantId),
    },
    lessons: { findByIds: (tenantId, ids) => lessons.findByIds(tenantId, ids) },
    stock: createStockRepository(tx),
    productDrafts: createProductDraftRepository(tx),
    salesLinks: createSalesLinkRepository(tx),
    changeProposals: createChangeProposalRepository(tx, bounds),
    changeProposalEvents: createChangeProposalEventRepository(tx),
    changeProposalGroups: createChangeProposalGroupRepository(tx, bounds),
    targets: createChangeProposalTargetLocks(tx),
    quarantinedImages: createQuarantinedImageLocks(tx),
    keyDownloadAttach: createKeyDownloadAttachRepository(tx),
    productFiles: createChangeProposalProductFiles(tx),
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
  bounds: ChangeProposalBounds,
  secretResolverOver: SecretResolverOver,
  effects: PostCommitEffect[],
  isOpen: () => boolean,
): ChangeProposalTransactionScope => ({
  repositories: repositoriesOver(tx, bounds),
  secretResolver: secretResolverOver(tx),
  afterCommit: collectorInto(effects, isOpen),
  savepoint: async (operation) => {
    const nested: PostCommitEffect[] = [];
    let savepointOpen = true;
    const result = await rollingBackErrors(tx, (savepointTx) =>
      operation(scopeOver(savepointTx, bounds, secretResolverOver, nested, () => savepointOpen && isOpen())))
      .finally(() => { savepointOpen = false; });
    if (result.ok) effects.push(...nested);
    return result;
  },
});

export const createChangeProposalTransaction = (
  db: Db,
  logger: { error(message: string): void },
  secretResolverOver: SecretResolverOver,
  options: ChangeProposalBoundOptions = {},
): ChangeProposalTransaction => {
  const bounds = changeProposalBounds(options);
  const runScoped = async <T>(
    tenantId: string,
    operation: ScopedOperation<T>,
    rollBackAlways: boolean,
    groupId: string | null,
    lockWait: number | undefined = undefined,
  ) => {
    const scopedBounds = lockWait === undefined ? bounds : { ...bounds, lockWaitMs: Math.min(bounds.lockWaitMs, lockWaitMs(lockWait)) };
    const waits = { lockWaitMs: scopedBounds.lockWaitMs, lockWaitAfterMs: scopedBounds.lockWaitMs };
    const effects: PostCommitEffect[] = [];
    let open = true;
    try {
      const result = await rollingBackErrors(db, async (tx): Promise<Result<T, AppError>> => {
        if (groupId !== null && !await boundedAdvisoryLock(tx, `change-proposal-group-dry-run:${tenantId}:${groupId}`, waits)) {
          return err(changeProposalsBusy());
        }
        if (!await boundedAdvisoryLock(tx, `change-proposal-transaction:${tenantId}`, waits)) return err(changeProposalsBusy());
        await boundStatementTime(tx, rollBackAlways ? bounds.dryRunStatementMs : bounds.approvalStatementMs);
        return operation(scopeOver(tx, scopedBounds, secretResolverOver, effects, () => open));
      }, rollBackAlways).finally(() => { open = false; });
      return { result, effects: result.ok && !rollBackAlways ? effects : [] };
    } catch (cause) {
      // A lock wait or a statement that ran out of time, or a deadlock, aborted the whole transaction, which has rolled back by now, so nothing was applied.
      if (ranOutOfTime(cause)) return { result: err<AppError>(changeProposalsBusy()), effects: [] };
      throw cause;
    }
  };

  return {
    run: async (tenantId, operation, options = {}) => {
      const { result, effects } = await runScoped(tenantId, operation, false, null, options.lockWaitMs);
      for (const effect of effects) {
        try {
          await effect();
        } catch (cause) {
          logger.error(`[change-proposal] post-commit effect failed tenant=${tenantId}: ${serializeErrorChain(cause)}`);
        }
      }
      return result;
    },
    dryRun: async (tenantId, operation, options = {}) => (await runScoped(tenantId, operation, true, options.groupId ?? null)).result,
  };
};
