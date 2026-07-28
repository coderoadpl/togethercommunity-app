import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';

import { err, internal, validation, type Identity } from '#core/domain/index.js';

import type { AppDeps } from './composition.js';
import { registerInternalRoutes } from './internal-app.js';
import {
  assertPublicRouteManifest,
  PUBLIC_ROUTE_MANIFEST,
} from './public-route-manifest.js';
import { registerPublicRoutes } from './public-app.js';
import { respond } from './respond.js';
import { recordException, telemetryMiddleware } from './telemetry.js';

type Vars = { Variables: { identity: Identity } };

export const buildApp = (deps: AppDeps) => {
  const app = new Hono<Vars>();

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        frameSrc: ['https:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: 'strict-origin-when-cross-origin',
    }),
  );
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 100 * 1024,
      onError: () => respond(err(validation('Request body exceeds the 100KB limit'))),
    }),
  );
  app.use('*', telemetryMiddleware);
  app.onError((error) => {
    recordException(error);
    return respond(err(internal()));
  });

  const publicRouteStart = app.routes.length;
  registerPublicRoutes(app, deps);
  assertPublicRouteManifest(app.routes.slice(publicRouteStart), PUBLIC_ROUTE_MANIFEST);
  registerInternalRoutes(app, deps);

  return app;
};
