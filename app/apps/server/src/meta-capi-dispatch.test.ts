import { describe, expect, it, vi } from 'vitest';
import { err, notFound, ok } from '#core/domain/index.js';
import type { MetaCapiDispatchDeps } from '#core/server/usecases/meta-capi.js';
import { runMetaCapiDispatch } from './meta-capi-dispatch.js';

const setup = () => {
  const listAll = vi.fn<MetaCapiDispatchDeps['directory']['listAll']>(async () => []);
  const warn = vi.fn();
  const deps: MetaCapiDispatchDeps = {
    clock: { nowIso: () => '2026-11-01T10:00:00.000Z' }, hash: { sha256: () => 'hash' },
    tenants: { findSettings: async () => null }, directory: { listAll },
    secrets: { resolve: async () => ok('test-token') }, gateway: { send: async () => ({ ok: true, fbtraceId: null }) },
    repository: { findOrder: async () => null, decide: async () => err(notFound()), processNext: async () => false,
      listEvents: async () => [], listMemberConsents: async () => [] },
  };
  return { deps, listAll, logger: { warn } };
};

describe('shared Meta dispatch runner', () => {
  it('skips an unconfigured dispatcher', async () => {
    const h = setup();
    await runMetaCapiDispatch(undefined, h.logger, 'node ticker');
    expect(h.listAll).not.toHaveBeenCalled();
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it('prevents overlapping ticker and cron cycles and releases the guard on completion', async () => {
    const h = setup();
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    h.listAll.mockImplementationOnce(async () => { await pending; return []; });
    const first = runMetaCapiDispatch(h.deps, h.logger, 'node ticker');
    try {
      await runMetaCapiDispatch(h.deps, h.logger, 'node ticker');
      await runMetaCapiDispatch(h.deps, h.logger, 'cron');
      expect(h.listAll).toHaveBeenCalledOnce();
    } finally {
      release();
      await first;
    }
    await runMetaCapiDispatch(h.deps, h.logger, 'cron');
    expect(h.listAll).toHaveBeenCalledTimes(2);
  });

  it.each(['cron', 'node ticker'] as const)('isolates %s failures without logging exception data and allows the next cycle', async (source) => {
    const h = setup();
    h.listAll.mockRejectedValueOnce(new Error('buyer@example.org token\nparams: private-session'));
    await expect(runMetaCapiDispatch(h.deps, h.logger, source)).resolves.toBeUndefined();
    expect(h.logger.warn.mock.calls).toEqual([[`[meta-capi] ${source} dispatch_failed`]]);
    await runMetaCapiDispatch(h.deps, h.logger, source);
    expect(h.listAll).toHaveBeenCalledTimes(2);
    expect(h.logger.warn).toHaveBeenCalledOnce();
  });
});
