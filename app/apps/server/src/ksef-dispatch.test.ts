import { describe, expect, it, vi } from 'vitest';

import { err, internal } from '#core/domain/index.js';

import { dispatchKsefInBackground } from './ksef-dispatch.js';

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
        '[ksef] payment fulfilment dispatch rejected: Error: pool exhausted',
      );
    });
  });
});
