import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '#core/client/index.js';
import { appError, type ErrorCode } from '#core/domain/index.js';

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('./observability.js', () => ({ reportError }));

const { queryClient } = await import('./query-client.js');

const rejectWith = (error: ApiError) => () => Promise.reject(error);

const failWith = async (queryKey: readonly unknown[], code: ErrorCode): Promise<ApiError> => {
  const error = new ApiError(appError(code, `${code} failure`));
  await expect(
    queryClient.fetchQuery({ queryKey, queryFn: rejectWith(error), retry: false }),
  ).rejects.toBe(error);
  return error;
};

afterEach(() => {
  queryClient.clear();
  reportError.mockClear();
});

describe('query error reporting', () => {
  it.each(['public-offer', 'me', 'public-navigation'])(
    'does not report a missing workspace on the %s boot query',
    async (key) => {
      await failWith([key], 'tenant_not_found');

      expect(reportError).not.toHaveBeenCalled();
    },
  );

  it.each(['internal', 'forbidden', 'not_found'] as const)(
    'reports %s on a boot query',
    async (code) => {
      const error = await failWith(['public-offer'], code);

      expect(reportError).toHaveBeenCalledWith(error);
    },
  );

  it.each([
    ['another query', ['member-navigation']],
    ['a longer boot-like key', ['public-offer', 'acme']],
  ])('reports a missing workspace on %s', async (_label, queryKey) => {
    const error = await failWith(queryKey, 'tenant_not_found');

    expect(reportError).toHaveBeenCalledWith(error);
  });

  it('does not report an anonymous session answer on me', async () => {
    await failWith(['me'], 'unauthorized');

    expect(reportError).not.toHaveBeenCalled();
  });

  it.each([
    ['public-navigation', ['public-navigation']],
    ['a longer me key', ['me', 'details']],
  ])('reports unauthorized on %s', async (_label, queryKey) => {
    const error = await failWith(queryKey, 'unauthorized');

    expect(reportError).toHaveBeenCalledWith(error);
  });
});
