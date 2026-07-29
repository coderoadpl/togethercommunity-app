import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '#core/client/index.js';

import { refreshToastStore } from './refresh-toast.js';

const { queryClient } = await import('./query-client.js');

const failingQuery = async (error: Error): Promise<never> => {
  throw error;
};

afterEach(() => {
  queryClient.clear();
  refreshToastStore.dismiss();
});

describe('query retry policy', () => {
  it.each(['validation', 'unauthorized'] as const)('does not retry %s API errors', async (code) => {
    const queryFn = vi.fn(() =>
      failingQuery(new ApiError({ code, message: `${code} failure` })),
    );

    await expect(
      queryClient.fetchQuery({ queryKey: ['no-retry', code], queryFn, retryDelay: 0 }),
    ).rejects.toThrow(`${code} failure`);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['internal', new ApiError({ code: 'internal', message: 'Internal failure' })],
    ['network', new Error('Network failure')],
  ])('stops retrying %s failures after three retries', async (label, error) => {
    const queryFn = vi.fn(() => failingQuery(error));

    await expect(
      queryClient.fetchQuery({ queryKey: ['retry', label], queryFn, retryDelay: 0 }),
    ).rejects.toThrow(error.message);
    expect(queryFn).toHaveBeenCalledTimes(4);
  });
});

describe('refresh error policy', () => {
  it('shows one toast when a stale-data refresh fails', async () => {
    const listener = vi.fn();
    const unsubscribe = refreshToastStore.subscribe(listener);
    queryClient.setQueryData(['stale'], { value: 'kept' });

    await expect(
      queryClient.fetchQuery({
        queryKey: ['stale'],
        queryFn: () =>
          failingQuery(new ApiError({ code: 'validation', message: 'Refresh rejected' })),
        retryDelay: 0,
        staleTime: 0,
      }),
    ).rejects.toThrow('Refresh rejected');

    expect(refreshToastStore.snapshot()).toEqual({ code: 'validation' });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does not show a toast when the initial load fails', async () => {
    await expect(
      queryClient.fetchQuery({
        queryKey: ['initial'],
        queryFn: () => failingQuery(new Error('Offline')),
        retry: false,
      }),
    ).rejects.toThrow('Offline');

    expect(refreshToastStore.snapshot()).toBeNull();
  });
});
