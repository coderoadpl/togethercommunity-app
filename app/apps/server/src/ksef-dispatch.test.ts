import { describe, expect, it, vi } from 'vitest';

import { err, internal } from '#core/domain/index.js';

import { dispatchKsef, dispatchKsefInBackground } from './ksef-dispatch.js';

describe('dispatchKsefInBackground', () => {
  it('logs returned dispatcher failures', async () => {
    const error = vi.fn();

    dispatchKsefInBackground({
      dispatch: async () => err(internal('database unavailable')),
    }, { error }, 'invoice issue');

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        '[ksef] invoice issue dispatch failed: database unavailable',
      );
    });
  });

  it('handles and logs rejected dispatcher promises', async () => {
    const error = vi.fn();

    dispatchKsefInBackground({
      dispatch: async () => {
        throw new Error('pool exhausted');
      },
    }, { error }, 'payment fulfilment');

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        '[ksef] payment fulfilment dispatch rejected: pool exhausted',
      );
    });
  });

  it('hands the dispatch to the shutdown tracker so the process waits for it', async () => {
    const error = vi.fn();
    const tracked: Promise<unknown>[] = [];

    dispatchKsefInBackground({
      dispatch: async () => err(internal('provider timeout')),
    }, { error }, 'invoice send', (task) => { tracked.push(task); });

    expect(tracked).toHaveLength(1);
    await tracked[0];
    expect(error).toHaveBeenCalledWith('[ksef] invoice send dispatch failed: provider timeout');
  });

  it('settles only after the dispatch it awaited has been logged', async () => {
    const error = vi.fn();

    await dispatchKsef({
      dispatch: async () => err(internal('session expired')),
    }, { error }, 'node ticker');

    expect(error).toHaveBeenCalledWith('[ksef] node ticker dispatch failed: session expired');
  });

  it('resolves without work when KSeF is not configured', async () => {
    const error = vi.fn();

    await expect(dispatchKsef(undefined, { error }, 'node ticker')).resolves.toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });
});
