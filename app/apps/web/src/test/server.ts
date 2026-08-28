import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import pkg from '../../../../package.json' with { type: 'json' };

export const server = setupServer(
  http.get('*/api/messages/unread-count', () =>
    HttpResponse.json({ ok: true, data: { unread: 0 } }),
  ),
  http.get('*/api/member/navigation', () =>
    HttpResponse.json({ ok: true, data: { navigation: { spaces: [], courses: [], lockedSpaces: [] } } }),
  ),
  http.get('*/api/member/upcoming-events', () =>
    HttpResponse.json({ ok: true, data: { events: [] } }),
  ),
  http.get('*/api/spaces/:spaceId/events', () =>
    HttpResponse.json({ ok: true, data: { events: [], nextCursor: null } }),
  ),
  http.get('*/api/public/spaces/:spaceId/events', () =>
    HttpResponse.json({ ok: true, data: { events: [], nextCursor: null } }),
  ),
  http.get('*/api/health', () =>
    HttpResponse.json({
      ok: true,
      data: {
        status: 'ok',
        database: 'up',
        version: pkg.version,
        sha: 'unknown',
        environment: 'test',
        production: false,
        commit: null,
        databaseFingerprint: null,
        expectedMigrations: 82,
        appliedMigrations: 82,
        schemaCurrent: true,
        schemaFingerprint: 'c087b16a6bb6',
        schemaFingerprintMatch: true,
      },
    }),
  ),
);
