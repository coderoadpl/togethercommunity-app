import { describe, expect, it } from 'vitest';

import { createCoalescedRunner } from './coalesced-runner.js';

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

describe('createCoalescedRunner', () => {
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
