import { BETTER_AUTH_MAGIC_LINK_PATH, BETTER_AUTH_PASSWORD_SIGN_IN_PATH } from '#adapters/auth/create-auth.js';
import { createHmac, hkdfSync } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import { z } from 'zod';
import type { MiddlewareHandler } from 'hono';

import { normalizeEmail } from '#core/domain/index.js';

import { API_PATHS } from '#core/contract/index.js';

export const SIGN_IN_RESPONSE_FLOOR_MS = 300;

const SIGN_IN_PATHS = new Set<string>([
  API_PATHS.authResolve,
  BETTER_AUTH_MAGIC_LINK_PATH,
  BETTER_AUTH_PASSWORD_SIGN_IN_PATH,
]);

export const signInTimingMiddleware = (secret: string): MiddlewareHandler => async (c, next) => {
  if (c.req.method !== 'POST' || !SIGN_IN_PATHS.has(c.req.path)) {
    await next();
    return;
  }
  const startedAt = performance.now();
  const payload: unknown = await c.req.raw.clone().json().catch(() => null);
  const input = z.object({ email: z.string().transform(normalizeEmail).pipe(z.string().email()) }).safeParse(payload);
  const span = trace.getActiveSpan();
  if (input.success) span?.setAttribute('auth.email_hash', createHmac('sha256', Buffer.from(hkdfSync('sha256', secret, '', 'together:sign-in-telemetry:email-hash:v1', 32))).update(input.data.email).digest('hex'));
  try {
    await next();
  } finally {
    span?.setAttribute('auth.outcome', c.res.status < 400 ? 'accepted' : 'rejected');
    span?.setAttribute('auth.reason', c.res.status === 429 ? 'rate_limited' : c.res.status === 401 ? 'invalid_credentials' : c.res.status < 400 ? 'completed' : 'request_failed');
    while (performance.now() - startedAt < SIGN_IN_RESPONSE_FLOOR_MS) {
      await new Promise((resolve) => setTimeout(resolve, Math.ceil(SIGN_IN_RESPONSE_FLOOR_MS - (performance.now() - startedAt))));
    }
  }
};
