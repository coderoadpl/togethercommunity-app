import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { NONCE, secureHeaders } from 'hono/secure-headers';

import { BETTER_AUTH_API_PATH_PATTERN } from '#adapters/auth/create-auth.js';
import { err, internal, notFound, validation, type Identity } from '#core/domain/index.js';

import type { AppDeps } from './composition.js';
import { registerInternalRoutes } from './internal-app.js';
import {
  assertPublicRouteManifest,
  PUBLIC_ROUTE_MANIFEST,
} from './public-route-manifest.js';
import { registerPublicRoutes } from './public-app.js';
import { respond } from './respond.js';
import { recordException, telemetryMiddleware } from './telemetry.js';

type Vars = { Variables: { identity: Identity; secureHeadersNonce?: string } };
const betterAuthPathPrefix = BETTER_AUTH_API_PATH_PATTERN.slice(0, -1);

const routePathMatches = (routePath: string, requestPath: string): boolean => {
  const routeSegments = routePath.split('/');
  const requestSegments = requestPath.split('/');
  for (let index = 0; index < routeSegments.length; index += 1) {
    const routeSegment = routeSegments[index];
    if (routeSegment === '*') return true;
    const requestSegment = requestSegments[index];
    if (requestSegment === undefined) return false;
    if (routeSegment?.startsWith(':')) continue;
    if (routeSegment !== requestSegment) return false;
  }
  return routeSegments.length === requestSegments.length;
};

export const buildApp = (deps: AppDeps) => {
  const app = new Hono<Vars>();

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", NONCE],
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
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith(betterAuthPathPrefix)) {
      await next();
      return;
    }
    const routeExists = app.routes.some((route) =>
      route.method !== 'ALL'
      && route.method === c.req.method
      && routePathMatches(route.path, c.req.path),
    );
    if (!routeExists) {
      return respond(err(notFound(`No API route for ${c.req.method} ${c.req.path}`)));
    }
    await next();
  });
  app.onError((error) => {
    recordException(error);
    return respond(err(internal()));
  });

  const publicRouteStart = app.routes.length;
  registerPublicRoutes(app, deps);
  assertPublicRouteManifest(app.routes.slice(publicRouteStart), PUBLIC_ROUTE_MANIFEST);
  registerInternalRoutes(app, deps);
  app.all('/api/*', (c) =>
    c.req.path.startsWith(betterAuthPathPrefix)
      ? deps.auth.handler(c.req.raw)
      : respond(err(notFound(`No API route for ${c.req.method} ${c.req.path}`))),
  );

  return app;
};
