import { BETTER_AUTH_MAGIC_LINK_PATH, BETTER_AUTH_PASSWORD_SIGN_IN_PATH } from '#adapters/auth/create-auth.js';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { SIGN_IN_RESPONSE_FLOOR_MS, signInTimingMiddleware } from './sign-in-timing.js';

describe('sign-in timing floor', () => {
  it('pins the response floor at 300 ms', () => {
    expect(SIGN_IN_RESPONSE_FLOOR_MS).toBe(300);
  });

  it.each(['/api/public/auth-resolve', BETTER_AUTH_MAGIC_LINK_PATH, BETTER_AUTH_PASSWORD_SIGN_IN_PATH])(
    'pads successful and rejected requests at %s', async (path) => {
      const app = new Hono();
      app.use('*', signInTimingMiddleware('test-sign-in-telemetry-secret'));
      app.post('*', (c) => c.json({ status: 'uniform' }, c.req.header('x-rejected') ? 401 : 200));
      for (const rejected of [false, true]) {
        const started = performance.now();
        const response = await app.request(path, {
          method: 'POST', headers: { 'content-type': 'application/json', ...(rejected ? { 'x-rejected': 'true' } : {}) },
          body: JSON.stringify({ email: rejected ? 'unknown@example.com' : 'member@example.com' }),
        });
        expect(performance.now() - started).toBeGreaterThanOrEqual(300);
        expect(response.status).toBe(rejected ? 401 : 200);
      }
    },
  );
});
