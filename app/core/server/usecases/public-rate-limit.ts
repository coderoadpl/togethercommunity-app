import { appError, err, internal, ok, type AppError, type Result } from '#core/domain/index.js';

import type { Clock, PublicRateLimitRepository } from '../ports.js';

export interface RateLimitWindow {
  limit: number;
  windowMs: number;
}

export interface PublicRateLimitDeps {
  buckets: PublicRateLimitRepository;
  clock: Clock;
}

const windowStart = (now: string, windowMs: number): string =>
  new Date(Math.floor(Date.parse(now) / windowMs) * windowMs).toISOString();

const retryAfterSeconds = (now: string, startedAt: string, windowMs: number): number =>
  Math.max(1, Math.ceil((Date.parse(startedAt) + windowMs - Date.parse(now)) / 1_000));

export const claimRateLimitWindow = async (
  input: { scope: string; key: string; window: RateLimitWindow },
  deps: PublicRateLimitDeps,
): Promise<Result<void, AppError>> => {
  if (input.window.limit <= 0 || input.window.windowMs <= 0) return ok(undefined);
  const now = deps.clock.nowIso();
  const startedAt = windowStart(now, input.window.windowMs);
  const claimed = await deps.buckets.claim({
    scope: input.scope,
    key: input.key,
    windowStartedAt: startedAt,
    expiresAt: new Date(Date.parse(startedAt) + input.window.windowMs).toISOString(),
    limit: input.window.limit,
  });
  return claimed
    ? ok(undefined)
    : err(appError('rate_limited', 'Too many requests', {
        retryAfterSeconds: retryAfterSeconds(now, startedAt, input.window.windowMs),
      }));
};

export const purgeExpiredRateLimitWindows = async (
  deps: PublicRateLimitDeps,
): Promise<Result<{ purged: number }, AppError>> => {
  try {
    return ok({ purged: await deps.buckets.purgeExpired(deps.clock.nowIso()) });
  } catch (cause) {
    return err(internal(cause instanceof Error ? cause.message : String(cause)));
  }
};
