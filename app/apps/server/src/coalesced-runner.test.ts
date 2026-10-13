import { describe, expect, it, vi } from 'vitest';

import { createCoalescedRunner } from './coalesced-runner.js';

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

describe('createCoalescedRunner', () => {
  it('keeps each started loop alive until its follow-up finishes', async () => {
    const gates = [deferred(), deferred(), deferred()];
    const keepAlive = vi.fn<(task: Promise<unknown>) => void>();
    let runs = 0;
    const trigger = createCoalescedRunner(async () => {
      runs += 1;
      await gates[runs - 1]?.promise;
    }, keepAlive);

    trigger();
    trigger();
    expect(keepAlive).toHaveBeenCalledTimes(1);
    const firstLoop = keepAlive.mock.calls[0]?.[0];
    expect(firstLoop).toBeInstanceOf(Promise);
    let settled = false;
    void firstLoop?.then(() => {
      settled = true;
    });

    gates[0]?.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(runs).toBe(2);
    expect(settled).toBe(false);
    expect(keepAlive).toHaveBeenCalledTimes(1);

    gates[1]?.resolve();
    await firstLoop;
    expect(settled).toBe(true);

    trigger();
    expect(keepAlive).toHaveBeenCalledTimes(2);
    expect(keepAlive.mock.calls[1]?.[0]).not.toBe(firstLoop);
    gates[2]?.resolve();
    await keepAlive.mock.calls[1]?.[0];
    expect(runs).toBe(3);
  });

  it('collapses a burst of triggers into one run plus a single follow-up', async () => {
    const gates = [deferred(), deferred()];
    let runs = 0;
    const trigger = createCoalescedRunner(async () => {
      runs += 1;
      await gates[runs - 1]?.promise;
    });

    trigger();
    trigger();
    trigger();
    trigger();
    expect(runs).toBe(1);

    gates[0]?.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(runs).toBe(2);

    gates[1]?.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(runs).toBe(2);
  });

  it('starts a fresh run once the previous one settled', async () => {
    let runs = 0;
    const trigger = createCoalescedRunner(async () => {
      runs += 1;
    });

    trigger();
    await Promise.resolve();
    await Promise.resolve();
    trigger();
    await Promise.resolve();
    await Promise.resolve();

    expect(runs).toBe(2);
  });

  it('keeps accepting triggers after a run rejects', async () => {
    let runs = 0;
    const trigger = createCoalescedRunner(async () => {
      runs += 1;
      throw new Error('dispatch failed');
    });

    trigger();
    await Promise.resolve();
    await Promise.resolve();
    trigger();
    await Promise.resolve();
    await Promise.resolve();

    expect(runs).toBe(2);
  });
});
