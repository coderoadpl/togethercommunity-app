import {
  err,
  ok,
  storageListInputSchema,
  validation,
  type StorageListedObject,
} from '#core/domain/index.js';

import type { StorageProvider } from '../ports.js';

export const createMemoryStorageList = (
  objects: StorageListedObject[] = [],
  pageSize = 1000,
): StorageProvider['list'] => async (input) => {
  const parsed = storageListInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid storage listing request'));
  const matching = objects.filter((object) => object.key.startsWith(parsed.data.prefix))
    .sort((left, right) => left.key.localeCompare(right.key));
  const offset = parsed.data.continuationToken === null ? 0 : Number(parsed.data.continuationToken);
  if (!Number.isSafeInteger(offset) || offset < 0 || pageSize < 1) return err(validation('Invalid listing cursor'));
  const page = matching.slice(offset, offset + Math.min(pageSize, parsed.data.limit));
  const next = offset + page.length;
  return ok({ objects: page, continuationToken: next < matching.length ? String(next) : null });
};
