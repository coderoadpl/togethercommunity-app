import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { Identity } from '#core/domain/index.js';

import { registerMarketingImportWorkerRoute } from './marketing-contact-routes.js';

describe('directory worker authentication', () => {
  it('rejects missing and incorrect operator secrets before accessing repositories', async () => {
    const app = new Hono<{ Variables: { identity: Identity } }>();
    registerMarketingImportWorkerRoute(app, { clock: { nowIso: () => '2026-09-08T10:00:00.000Z' }, ids: { nextId: () => 'id' }, marketingImportCronSecret: 'expected-secret' });
    expect((await app.request('/api/internal/marketing/imports/tick')).status).toBe(401);
    expect((await app.request('/api/internal/marketing/imports/tick', { headers: { authorization: 'Bearer wrong-secret' } })).status).toBe(401);
  });
});
