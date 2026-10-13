import { describe, expect, it, vi } from 'vitest';

import { createTrustedOrigins } from './trusted-origins.js';

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
    now = 59_999;
    expect(await trustedOrigins()).toEqual([...configuredOrigins, customOrigin]);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(1);
    now = 60_000;
    expect(await trustedOrigins()).toEqual([...configuredOrigins, 'https://courses.studio.example']);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(2);
  });

  it('falls back to configured origins on initial failure and coalesces concurrent calls', async () => {
    const failure = new Error('Database unavailable');
    const loadCustomOrigins = vi.fn().mockRejectedValue(failure);
    const error = vi.fn();
    const trustedOrigins = createTrustedOrigins({
      configuredOrigins,
      loadCustomOrigins,
      logger: { error },
      now: () => 0,
    });

    expect(await Promise.all([trustedOrigins(), trustedOrigins(), trustedOrigins()]))
      .toEqual([configuredOrigins, configuredOrigins, configuredOrigins]);
    expect(await trustedOrigins()).toEqual(configuredOrigins);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Database unavailable'));
  });

  it('retains the last successful domains, logs once per outage and recovers on refresh', async () => {
    let now = 0;
    const error = vi.fn();
    const loadCustomOrigins = vi.fn()
      .mockResolvedValueOnce([customOrigin])
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockRejectedValueOnce(new Error('Still unavailable'))
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('New outage'));
    const trustedOrigins = createTrustedOrigins({
      configuredOrigins,
      loadCustomOrigins,
      logger: { error },
      now: () => now,
    });

    expect(await trustedOrigins()).toEqual([...configuredOrigins, customOrigin]);
    now = 60_000;
    expect(await trustedOrigins()).toEqual([...configuredOrigins, customOrigin]);
    now = 120_000;
    expect(await trustedOrigins()).toEqual([...configuredOrigins, customOrigin]);
    expect(error).toHaveBeenCalledTimes(1);
    now = 180_000;
    expect(await trustedOrigins()).toEqual(configuredOrigins);
    now = 240_000;
    expect(await trustedOrigins()).toEqual(configuredOrigins);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('does not expose its cached origins to caller mutations', async () => {
    const trustedOrigins = createTrustedOrigins({
      configuredOrigins,
      loadCustomOrigins: async () => [customOrigin],
      logger: { error: vi.fn() },
      now: () => 0,
    });

    const origins = await trustedOrigins();
    origins.push('https://untrusted.example');
    expect(await trustedOrigins()).toEqual([...configuredOrigins, customOrigin]);
  });

  it.each([false, true])('preserves fallback and recovery when logging throws (cached domains: %s)', async (cached) => {
    let now = 0;
    const error = vi.fn(() => { throw new Error('Logger unavailable'); });
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
      logger: { error },
      now: () => now,
    });
    const fallback = cached ? [...configuredOrigins, customOrigin] : configuredOrigins;
    if (cached) {
      expect(await trustedOrigins()).toEqual(fallback);
      now += 60_000;
    }

    await expect(Promise.all([trustedOrigins(), trustedOrigins()])).resolves.toEqual([fallback, fallback]);
    expect(await trustedOrigins()).toEqual(fallback);
    expect(loadCustomOrigins).toHaveBeenCalledTimes(cached ? 2 : 1);
    now += 60_000;
    expect(await trustedOrigins()).toEqual(fallback);
    expect(error).toHaveBeenCalledTimes(1);
    now += 60_000;
    const recovered = [...configuredOrigins, 'https://courses.studio.example'];
    expect(await trustedOrigins()).toEqual(recovered);
    now += 60_000;
    expect(await trustedOrigins()).toEqual(recovered);
    expect(error).toHaveBeenCalledTimes(2);
  });
});
