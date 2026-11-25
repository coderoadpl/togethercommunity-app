import { ok } from '#core/domain/index.js';

import type { ChangeProposalPostCommitEffects, StorageProvider } from './ports.js';

const unavailable = (method: string): Error =>
  new Error(`Storage ${method} is not available inside a change proposal transaction`);

// A storage effect must never escape an uncommitted change: deletions wait for COMMIT and every other call fails.
export const storageWithDeletesAfterCommit = (
  storage: StorageProvider,
  afterCommit: ChangeProposalPostCommitEffects,
  logger: { error(message: string): void },
): StorageProvider => ({
  objectUrl: (configuration, key) => storage.objectUrl(configuration, key),
  delete: async (input) => {
    afterCommit.defer(async () => {
      const deleted = await storage.delete(input);
      if (!deleted.ok) logger.error(`[change-proposal] could not delete a storage object after commit: ${deleted.error.message}`);
    });
    return ok({ deleted: true });
  },
  list: () => Promise.reject(unavailable('list')),
  getObject: () => Promise.reject(unavailable('getObject')),
  putObject: () => Promise.reject(unavailable('putObject')),
  probe: () => Promise.reject(unavailable('probe')),
  probeCors: () => Promise.reject(unavailable('probeCors')),
  presignPut: () => { throw unavailable('presignPut'); },
  presignGet: () => { throw unavailable('presignGet'); },
  head: () => Promise.reject(unavailable('head')),
  copyObject: () => Promise.reject(unavailable('copyObject')),
  digestObject: () => Promise.reject(unavailable('digestObject')),
  healthcheck: () => Promise.reject(unavailable('healthcheck')),
  test: () => Promise.reject(unavailable('test')),
});
