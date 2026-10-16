import { describe, expect, it, vi } from 'vitest';

import { CACHE_TTL_MS, createTrustedOrigins, FAILURE_RETRY_MS } from './trusted-origins.js';

const configuredOrigins = ['https://together.test', 'https://*.together.test'];
const customOrigin = 'https://courses.acme.example';

describe('createTrustedOrigins', () => {
  it('caches custom origins for 60 seconds and refreshes additions and removals', async () => {
    let now = 0;
    const loadCustomOrigins = vi.fn()
      .mockResolvedValueOnce([customOrigin, configuredOrigins[0]])
      .mockResolvedValueOnce(['https://courses.studio.example']);
    const trustedOrigins = createTrustedOrigins({
      configuredOrigins,
      loadCustomOrigins,
      logger: { error: vi.fn() },
      now: () => now,
    });

    expect(await trustedOrigins()).toEqual([...configuredOrigins, customOrigin]);
    now = CACHE_TTL_MS - 1;
    expect(await trustedOrigins()).toEqual([...configuredOrigins, customOrigin]);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(1);
    now = CACHE_TTL_MS;
    expect(await trustedOrigins()).toEqual([...configuredOrigins, 'https://courses.studio.example']);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(2);
  });

  it.each([0, 123_456])('retries a cold failure after one second (initial time: %s)', async (initialTime) => {
    let now = initialTime;
    const loadCustomOrigins = vi.fn()
      .mockRejectedValueOnce(new Error('Database unavailable'))
      .mockResolvedValueOnce([customOrigin]);
    const error = vi.fn();
    const warn = vi.fn();
    const trustedOrigins = createTrustedOrigins({
      configuredOrigins,
      loadCustomOrigins,
      logger: { error, warn },
      now: () => now,
    });

    expect(await trustedOrigins()).toEqual(configuredOrigins);
    now += FAILURE_RETRY_MS - 1;
    expect(await trustedOrigins()).toEqual(configuredOrigins);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(1);
    now += 1;
    expect(await trustedOrigins()).toEqual([...configuredOrigins, customOrigin]);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('cold=true'));
    expect(warn).toHaveBeenCalledExactlyOnceWith('[trusted-origins] Domain lookup recovered after 1 failures');
  });

  it('retries repeated cold failures without renewing the success TTL and logs once per outage', async () => {
    let now = 0;
    const error = vi.fn();
    const warn = vi.fn();
    const loadCustomOrigins = vi.fn()
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockRejectedValueOnce(new Error('Still unavailable'))
      .mockRejectedValueOnce(new Error('Still unavailable'))
      .mockResolvedValueOnce([customOrigin])
      .mockResolvedValueOnce([]);
    const trustedOrigins = createTrustedOrigins({
      configuredOrigins,
      loadCustomOrigins,
      logger: { error, warn },
      now: () => now,
    });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(await trustedOrigins()).toEqual(configuredOrigins);
      expect(loadCustomOrigins).toHaveBeenCalledTimes(attempt);
      now += FAILURE_RETRY_MS;
    }
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(await trustedOrigins()).toEqual([...configuredOrigins, customOrigin]);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledExactlyOnceWith('[trusted-origins] Domain lookup recovered after 3 failures');
    now += CACHE_TTL_MS - 1;
    expect(await trustedOrigins()).toEqual([...configuredOrigins, customOrigin]);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(4);
    now += 1;
    expect(await trustedOrigins()).toEqual(configuredOrigins);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(5);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('retains the last successful domains and recovers after the failure backoff', async () => {
    let now = 0;
    const error = vi.fn();
    const warn = vi.fn();
    const loadCustomOrigins = vi.fn()
      .mockResolvedValueOnce([customOrigin])
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce(['https://courses.studio.example'])
      .mockRejectedValueOnce(new Error('New outage'));
    const trustedOrigins = createTrustedOrigins({
      configuredOrigins,
      loadCustomOrigins,
      logger: { error, warn },
      now: () => now,
    });

    expect(await trustedOrigins()).toEqual([...configuredOrigins, customOrigin]);
    now = CACHE_TTL_MS;
    expect(await trustedOrigins()).toEqual([...configuredOrigins, customOrigin]);
    expect(error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('cold=false'));
    now += FAILURE_RETRY_MS - 1;
    expect(await trustedOrigins()).toEqual([...configuredOrigins, customOrigin]);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(2);
    now += 1;
    const recovered = [...configuredOrigins, 'https://courses.studio.example'];
    expect(await trustedOrigins()).toEqual(recovered);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledExactlyOnceWith('[trusted-origins] Domain lookup recovered after 1 failures');
    now += CACHE_TTL_MS;
    expect(await trustedOrigins()).toEqual(recovered);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('shares a failing refresh among concurrent callers and starts backoff when it finishes', async () => {
    let now = 0;
    let failRefresh: (cause: Error) => void = () => undefined;
    const refresh = new Promise<readonly string[]>((_resolve, reject) => {
      failRefresh = reject;
    });
    const loadCustomOrigins = vi.fn()
      .mockReturnValueOnce(refresh)
      .mockResolvedValueOnce([customOrigin]);
    const error = vi.fn();
    const trustedOrigins = createTrustedOrigins({
      configuredOrigins,
      loadCustomOrigins,
      logger: { error, warn: vi.fn() },
      now: () => now,
    });

    const callers = Promise.all([trustedOrigins(), trustedOrigins(), trustedOrigins()]);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(1);
    now = 10_000;
    failRefresh(new Error('Database unavailable'));
    expect(await callers).toEqual([configuredOrigins, configuredOrigins, configuredOrigins]);
    expect(error).toHaveBeenCalledTimes(1);
    now += FAILURE_RETRY_MS - 1;
    expect(await trustedOrigins()).toEqual(configuredOrigins);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(1);
    now += 1;
    expect(await trustedOrigins()).toEqual([...configuredOrigins, customOrigin]);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(2);
  });

  it('does not expose its cached origins to caller mutations', async () => {
    let now = 0;
    const loadCustomOrigins = vi.fn()
      .mockRejectedValueOnce(new Error('Database unavailable'))
      .mockResolvedValueOnce([customOrigin]);
    const trustedOrigins = createTrustedOrigins({
      configuredOrigins,
      loadCustomOrigins,
      logger: { error: vi.fn() },
      now: () => now,
    });

    const fallback = await trustedOrigins();
    fallback.push('https://untrusted.example');
    expect(await trustedOrigins()).toEqual(configuredOrigins);
    now += FAILURE_RETRY_MS;
    const [first, second] = await Promise.all([trustedOrigins(), trustedOrigins()]);
    first.push('https://untrusted.example');
    expect(second).toEqual([...configuredOrigins, customOrigin]);
    expect(await trustedOrigins()).toEqual([...configuredOrigins, customOrigin]);
  });

  it.each([false, true])('preserves fallback and recovery when logging throws (cached domains: %s)', async (cached) => {
    let now = 0;
    const error = vi.fn(() => { throw new Error('Logger unavailable'); });
    const warn = vi.fn(() => { throw new Error('Logger unavailable'); });
    const loadCustomOrigins = vi.fn<() => Promise<readonly string[]>>();
    if (cached) loadCustomOrigins.mockResolvedValueOnce([customOrigin]);
    loadCustomOrigins
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockRejectedValueOnce(new Error('Still unavailable'))
      .mockResolvedValueOnce(['https://courses.studio.example'])
      .mockRejectedValueOnce(new Error('New outage'));
    const trustedOrigins = createTrustedOrigins({
      configuredOrigins,
      loadCustomOrigins,
      logger: { error, warn },
      now: () => now,
    });
    const fallback = cached ? [...configuredOrigins, customOrigin] : configuredOrigins;
    if (cached) {
      expect(await trustedOrigins()).toEqual(fallback);
      now += CACHE_TTL_MS;
    }

    await expect(Promise.all([trustedOrigins(), trustedOrigins()])).resolves.toEqual([fallback, fallback]);
    expect(await trustedOrigins()).toEqual(fallback);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(cached ? 2 : 1);
    now += FAILURE_RETRY_MS;
    expect(await trustedOrigins()).toEqual(fallback);
    expect(error).toHaveBeenCalledTimes(1);
    now += FAILURE_RETRY_MS;
    const recovered = [...configuredOrigins, 'https://courses.studio.example'];
    expect(await trustedOrigins()).toEqual(recovered);
    expect(warn).toHaveBeenCalledTimes(1);
    now += CACHE_TTL_MS - 1;
    expect(await trustedOrigins()).toEqual(recovered);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(cached ? 4 : 3);
    now += 1;
    expect(await trustedOrigins()).toEqual(recovered);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('logs recovery through error when warn is unavailable and sanitizes failure details', async () => {
    let now = 0;
    const error = vi.fn();
    const loadCustomOrigins = vi.fn()
      .mockRejectedValueOnce(new Error('Query failed\nparams: private-value', {
        cause: new Error('Connection terminated unexpectedly'),
      }))
      .mockResolvedValueOnce([customOrigin]);
    const trustedOrigins = createTrustedOrigins({
      configuredOrigins,
      loadCustomOrigins,
      logger: { error },
      now: () => now,
    });

    expect(await trustedOrigins()).toEqual(configuredOrigins);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Connection terminated unexpectedly'));
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining('private-value'));
    now += FAILURE_RETRY_MS;
    expect(await trustedOrigins()).toEqual([...configuredOrigins, customOrigin]);
    expect(error).toHaveBeenLastCalledWith('[trusted-origins] Domain lookup recovered after 1 failures');
    expect(error).toHaveBeenCalledTimes(2);
  });
});
