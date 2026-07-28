import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  assertPublicRouteManifest,
  PUBLIC_ROUTE_MANIFEST,
} from '../apps/server/src/public-route-manifest.js';

describe('public route manifest fail-closed probe', () => {
  it('rejects an actual public mutating route missing from the manifest', () => {
    const app = new Hono();
    app.post('/unreviewed-write', (context) => context.json({ ok: true }));

    expect(() => assertPublicRouteManifest(app.routes, PUBLIC_ROUTE_MANIFEST)).toThrow(
      'POST /unreviewed-write',
    );
  });
});
