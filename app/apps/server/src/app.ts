import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { NONCE, secureHeaders } from 'hono/secure-headers';

import { BETTER_AUTH_API_PATH_PATTERN } from '#adapters/auth/create-auth.js';
import { err, internal, notFound, validation, type Identity } from '#core/domain/index.js';

import type { AppDeps } from './composition.js';
import { requestBodyLimit } from './body-limits.js';
import { registerInternalRoutes } from './internal-app.js';
import {
  assertPublicRouteManifest,
  PUBLIC_ROUTE_MANIFEST,
} from './public-route-manifest.js';
import { registerPublicRoutes } from './public-app.js';
import { respond } from './respond.js';
import { registerSocialPreviewRoute } from './social-preview.js';
import { recordException, telemetryMiddleware } from './telemetry.js';

type Vars = { Variables: { identity: Identity; secureHeadersNonce?: string } };
const betterAuthPathPrefix = BETTER_AUTH_API_PATH_PATTERN.slice(0, -1);
const isServerRenderedDocument = (path: string): boolean =>
  ['/u/', '/marketing/', '/legal/'].some((prefix) => path.startsWith(prefix));
const isSpaDocument = (path: string): boolean =>
  path !== '/api' && !path.startsWith('/api/') && !isServerRenderedDocument(path);

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

  app.use('*', async (c, next) =>
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", NONCE],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: isSpaDocument(c.req.path)
          ? ["'self'", 'https:']
          : ["'self'", 'https://*.sentry.io'],
        fontSrc: ["'self'", 'data:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        frameSrc: ['https:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: 'strict-origin-when-cross-origin',
    })(c, next));
  app.use('*', async (c, next) => {
    const maxSize = requestBodyLimit(c.req.method, c.req.path);
    if (maxSize === undefined) {
      await next();
      return;
    }
    return bodyLimit({
      maxSize,
      onError: () => respond(err(validation(`Request body exceeds the ${maxSize} byte limit`))),
    })(c, next);
  });
  app.use('*', telemetryMiddleware);
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith(betterAuthPathPrefix)) {
      await next();
      return;
    }
    const routeExists = app.routes.some((route) =>
      route.method !== 'ALL'
      && route.path !== '/*'
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
  const socialRouteStart = app.routes.length;
  registerSocialPreviewRoute(app, deps);
  assertPublicRouteManifest(app.routes.slice(socialRouteStart), PUBLIC_ROUTE_MANIFEST);

  return app;
};
