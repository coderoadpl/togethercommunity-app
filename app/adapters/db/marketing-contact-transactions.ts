import type { AppError } from '#core/domain/index.js';
import type { MarketingImportTransactionRepos, MarketingImportTransaction } from '#core/server/index.js';

import type { Db } from './client.js';
import { createMarketingContactRepository, createMarketingListRepository, createMarketingDirectoryEventRepository, type DirectoryRepositoryDeps } from './marketing-contact-repositories.js';
import { createMarketingContactImportRepository } from './marketing-contact-import-repository.js';
import { createMarketingMemberSyncRepository } from './marketing-member-sync.js';
import { createConsentDefinitionRepository, createMarketingConsentRepository, createSuppressionRepository } from './marketing-repositories.js';

export const createMarketingImportTransactionRepos = (db: Db, deps: DirectoryRepositoryDeps): MarketingImportTransactionRepos => ({
  contacts: createMarketingContactRepository(db, deps), lists: createMarketingListRepository(db, deps),
  imports: createMarketingContactImportRepository(db), directoryEvents: createMarketingDirectoryEventRepository(db),
  definitions: createConsentDefinitionRepository(db), consents: createMarketingConsentRepository(db), suppressions: createSuppressionRepository(db), memberSync: createMarketingMemberSyncRepository(db),
});
class DirectoryRollback extends Error {
  constructor(readonly failure: AppError) { super(failure.message); }
}
export const createMarketingImportTransaction = (db: Db, deps: DirectoryRepositoryDeps): MarketingImportTransaction => ({
  run: async (tenantId, operation) => {
    if (tenantId.length === 0) throw new Error('Tenant context is required');
    try {
      return await db.transaction(async (tx) => {
        const result = await operation(createMarketingImportTransactionRepos(tx, deps));
        if (!result.ok) throw new DirectoryRollback(result.error);
        return result;
      });
    } catch (error) {
      if (error instanceof DirectoryRollback) return { ok: false, error: error.failure };
      throw error;
    }
  },
});
