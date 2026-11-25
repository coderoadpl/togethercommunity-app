import { describe, expect, it, vi } from 'vitest';

import { err, internal, ok, type StorageConfiguration } from '#core/domain/index.js';

import { storageWithDeletesAfterCommit } from './change-proposal-effects.js';
import type { StorageProvider } from './ports.js';

const target = { url: 'https://storage.example.test/bucket/object', accessKeyId: 'access', secretAccessKey: 'secret' };
const configuration: StorageConfiguration = {
  provider: 'minio', endpoint: 'https://storage.example.test', bucket: 'bucket', accessKeyId: 'access', secretAccessKey: 'secret', region: 'auto',
};

const harness = (deleteResult: Awaited<ReturnType<StorageProvider['delete']>> = ok({ deleted: true })) => {
  const deferred: Array<() => Promise<void>> = [];
  const remove = vi.fn<StorageProvider['delete']>(async () => deleteResult);
  const objectUrl = vi.fn<StorageProvider['objectUrl']>(() => new URL(target.url));
  const unexpected = () => { throw new Error('The wrapped storage must not be called'); };
  const storage: StorageProvider = {
    delete: remove, objectUrl, list: unexpected, getObject: unexpected, putObject: unexpected, probe: unexpected,
    copyObject: unexpected, digestObject: unexpected, probeCors: unexpected, presignPut: unexpected, presignGet: unexpected, head: unexpected, healthcheck: unexpected, test: unexpected,
  };
  const logger = { error: vi.fn<(message: string) => void>() };
  const wrapped = storageWithDeletesAfterCommit(storage, { defer: (effect) => { deferred.push(effect); } }, logger);
  return { wrapped, deferred, remove, objectUrl, logger };
};

describe('storage inside a change proposal transaction', () => {
  it('defers an object deletion until the collected effects run', async () => {
    const h = harness();
    expect(await h.wrapped.delete(target)).toEqual(ok({ deleted: true }));
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.deferred).toHaveLength(1);
    await h.deferred[0]?.();
    expect(h.remove).toHaveBeenCalledWith(target);
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it('logs a deletion that fails after COMMIT', async () => {
    const h = harness(err(internal('bucket unreachable')));
    await h.wrapped.delete(target);
    await h.deferred[0]?.();
    expect(h.logger.error).toHaveBeenCalledWith(expect.stringContaining('bucket unreachable'));
  });

  it('builds object URLs from the wrapped storage', () => {
    const h = harness();
    expect(h.wrapped.objectUrl(configuration, 'object').toString()).toBe(target.url);
  });

  it('refuses every other storage call, so no other effect can escape the transaction', async () => {
    const h = harness();
    await expect(h.wrapped.putObject({ ...target, body: new Uint8Array(), contentType: 'image/png' })).rejects.toThrow(/not available/u);
    await expect(h.wrapped.getObject(target, { maxBytes: 1 })).rejects.toThrow(/not available/u);
    await expect(h.wrapped.head(target)).rejects.toThrow(/not available/u);
    expect(() => h.wrapped.presignPut({ ...target, expiresInSeconds: 60 })).toThrow(/not available/u);
    expect(() => h.wrapped.presignGet({ ...target, expiresInSeconds: 60 })).toThrow(/not available/u);
    expect(h.deferred).toHaveLength(0);
  });
});
