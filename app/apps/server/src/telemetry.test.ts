import { createHash, createHmac, hkdfSync } from 'node:crypto';
import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH } from '#adapters/auth/create-auth.js';
import { signInTimingMiddleware } from './sign-in-timing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { err, internal, type Identity } from '#core/domain/index.js';

import { recordException, telemetryMiddleware } from './telemetry.js';

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

const identity: Identity = {
  userId: 'user-1',
  email: 'creator@together.dev',
  name: 'Demo',
  emailVerified: true,
  tenantId: 'tenant-1',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: 'owner',
  memberId: null,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
};

type Vars = { Variables: { identity?: Identity } };

const buildProbeApp = () => {
  const app = new Hono<Vars>();
  app.use('*', telemetryMiddleware);
  app.onError((error) => {
    recordException(error);
    return new Response(JSON.stringify(err(internal())), { status: 500 });
  });
  app.get('/api/products', (c) => {
    c.set('identity', identity);
    return c.json({ ok: true, data: { products: [] } });
  });
  app.get('/api/boom', () => {
    throw new Error('kaboom');
  });
  app.get('/u/:token', (c) => c.text(c.req.param('token')));
  app.post('/api/webhooks/ses/:webhookToken', (c) => c.text(c.req.param('webhookToken')));
  app.post('/marketing/confirm/:token', (c) => c.text(c.req.param('token')));
  app.all('/api/*', (c) => c.json({ ok: false }, 404));
  app.get('*', (c) => c.text(`redirect ${c.req.path}`, 404));
  app.get('*', (c) => c.text(`preview ${c.req.path}`, 404));
  return app;
};

const soleSpan = async (): Promise<ReadableSpan> => {
  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(1);
  const [span] = spans;
  if (!span) throw new Error('expected exactly one span');
  return span;
};

beforeAll(() => {
  provider.register();
});

afterEach(() => {
  exporter.reset();
});

afterAll(async () => {
  await provider.shutdown();
});

describe('telemetryMiddleware', () => {
  it('emits exactly one wide event per request with the expected attributes', async () => {
    const response = await buildProbeApp().request('/api/products');
    expect(response.status).toBe(200);

    const span = await soleSpan();
    expect(span.name).toBe('GET /api/products');
    expect(span.attributes['http.request.method']).toBe('GET');
    expect(span.attributes['url.path']).toBeUndefined();
    expect(span.attributes['http.route']).toBe('/api/products');
    expect(span.attributes['http.response.status_code']).toBe(200);
    expect(typeof span.attributes['http.server.duration_ms']).toBe('number');
    expect(span.attributes['app.user.id']).toBe('user-1');
    expect(span.attributes['app.tenant.id']).toBe('tenant-1');
    expect(span.attributes['app.tenant.slug']).toBe('acme');
  });

  it('continues an incoming W3C traceparent as the same trace', async () => {
    const traceId = '0af7651916cd43dd8448eb211c80319c';
    await buildProbeApp().request('/api/products', {
      headers: { traceparent: `00-${traceId}-b7ad6b7169203331-01` },
    });

    const span = await soleSpan();
    expect(span.spanContext().traceId).toBe(traceId);
  });

  it('records the exception and a 500 status on an unhandled throw', async () => {
    const response = await buildProbeApp().request('/api/boom');
    expect(response.status).toBe(500);

    const span = await soleSpan();
    expect(span.name).toBe('GET /api/boom');
    expect(span.attributes['url.path']).toBeUndefined();
    expect(span.attributes['http.response.status_code']).toBe(500);
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events.some((event) => event.name === 'exception')).toBe(true);
  });

  it.each([
    { method: 'GET', path: '/u/live-unsubscribe-token', template: '/u/:token' },
    { method: 'POST', path: '/marketing/confirm/live-consent-token', template: '/marketing/confirm/:token' },
    { method: 'POST', path: '/api/webhooks/ses/live-ses-webhook-token', template: '/api/webhooks/ses/:webhookToken' },
  ])('redacts path tokens for $method $template', async ({ method, path, template }) => {
    const response = await buildProbeApp().request(path, { method });
    expect(response.status).toBe(200);

    const span = await soleSpan();
    expect(span.name).toBe(`${method} ${template}`);
    expect(span.attributes['url.path']).toBeUndefined();
    expect(span.attributes['http.route']).toBe(template);
    expect(span.name).not.toContain('live-');
    expect(String(span.attributes['url.path'])).not.toContain('live-');
  });

  it('omits route attributes when only catch-all routes match', async () => {
    const response = await buildProbeApp().request('/api/unknown/live-api-token');
    expect(response.status).toBe(404);

    const span = await soleSpan();
    expect(span.name).toBe('GET');
    expect(span.attributes['url.path']).toBeUndefined();
    expect(span.attributes['http.route']).toBeUndefined();
    expect(span.name).not.toContain('live-');
  });
});


it('records only an email hash and uniform sign-in outcome codes', async () => {
  const app = new Hono();
  app.use('*', telemetryMiddleware);
  app.use('*', signInTimingMiddleware('test-sign-in-telemetry-secret'));
  app.post(BETTER_AUTH_PASSWORD_SIGN_IN_PATH, (c) => c.json({ error: 'invalid_credentials' }, 401));
  await app.request(BETTER_AUTH_PASSWORD_SIGN_IN_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: '  Member@Example.com  ', password: 'secret-password', callbackURL: 'https://example.com/private-link' }),
  });
  const span = await soleSpan();
  expect(span.attributes['auth.email_hash']).toBe(
    createHmac('sha256', Buffer.from(hkdfSync('sha256', 'test-sign-in-telemetry-secret', '', 'together:sign-in-telemetry:email-hash:v1', 32))).update('member@example.com').digest('hex'),
  );
  expect(span.attributes['auth.email_hash']).not.toBe(createHash('sha256').update('member@example.com').digest('hex'));
  expect(span.attributes['auth.email_hash']).not.toBe(createHmac('sha256', 'test-sign-in-telemetry-secret').update('member@example.com').digest('hex'));
  expect(span.attributes['auth.outcome']).toBe('rejected');
  expect(span.attributes['auth.reason']).toBe('invalid_credentials');
  const serialized = JSON.stringify(span.attributes);
  expect(serialized).not.toContain('Member@Example.com');
  expect(serialized).not.toContain('secret-password');
  expect(serialized).not.toContain('private-link');
});
