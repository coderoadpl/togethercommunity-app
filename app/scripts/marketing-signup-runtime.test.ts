import { signupConfirmationToken, purgeSignupTestEvidence } from '#adapters/db/marketing-signup-test-helpers.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiClient } from '#core/client/index.js';
import { createDirectoryFixture, directoryCtx, directoryValue } from '#adapters/db/marketing-contact-test-fixture.js';
import { createMarketingSignupForm, getMarketingSignupForm, updateMarketingSignupForm } from '#core/server/index.js';
import { tenantAdmins, user } from '#adapters/db/schema.js';

import { buildApp } from '../apps/server/src/app.js';
import { createDeps } from '../apps/server/src/composition.js';
import { envSchema } from '../apps/server/src/env.js';

let fixture: Awaited<ReturnType<typeof createDirectoryFixture>>;
let deps: ReturnType<typeof createDeps>;
let app: ReturnType<typeof buildApp>;
let token: string;
const host = 'directory-a.example.org';
const submitPath = '/api/public/marketing/forms/newsletter/submit';
const request = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('host')) headers.set('host', host);
  return app.request(new Request(`https://${host}${path}`, { ...init, headers }));
};
const submit = (email: string, extra: Record<string, string> = {}, json = true, origin?: string) => request(submitPath, {
  method: 'POST', headers: { 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded', ...(origin === undefined ? {} : { origin }) },
  body: json ? JSON.stringify({ email, token, ...extra }) : new URLSearchParams({ email, token, ...extra }),
});
beforeAll(async () => {
  fixture = await createDirectoryFixture();
  deps = createDeps(envSchema.parse({ NODE_ENV: 'test', DATABASE_URL: fixture.url, REALTIME_TRANSPORT: 'in-process', APP_BASE_DOMAIN: 'example.org', APP_BASE_URL: 'https://platform.example.org', SECRETS_MASTER_KEY: Buffer.alloc(32, 1).toString('base64'), PUBLIC_RATE_LIMIT_SIGNUPS_PER_EMAIL_PER_10_MINUTES: 2 }), { db: fixture.db, clock: fixture.deps.clock });
  await fixture.db.insert(user).values({ id: 'signup-owner', email: 'owner@example.org', name: 'Owner', emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
  await fixture.db.insert(tenantAdmins).values({ id: 'signup-owner-grant', tenantId: 'directory-a', userId: 'signup-owner', role: 'owner' });
  app = buildApp({ ...deps, authPort: { ...deps.authPort, getAuthenticatedUser: async () => ({ sessionId: 'session', userId: 'signup-owner', email: 'owner@example.org', name: 'Owner', emailVerified: true, image: null }) } });
  if (deps.marketingSignup === undefined) throw new Error('Signup forms are unavailable');
  token = directoryValue(await createMarketingSignupForm(directoryCtx(), { slug: 'newsletter', name: 'Newsletter', consentDefinitionId: 'newsletter', listId: null, tags: ['signup'], collectName: true, successText: { en: 'Thank you', pl: 'Thank you' }, redirectUrl: null, allowedOrigins: ['https://embed.example.org'], status: 'active' }, deps.marketingSignup)).form.token;
}, 60_000);
afterAll(async () => { await fixture?.close(); });

describe('public signup HTTP boundary', () => {
  it('renders a branded accessible form and accepts form-encoded posts with a 303 redirect', async () => {
    const page = await request('/marketing/forms/newsletter?lang=en');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Directory A');
    expect(html).toContain('for="signup-email"');
    expect(html).toContain('aria-hidden="true" hidden');
    expect(html).toContain(token);
    const result = await submit('html@example.org', { displayName: 'HTML reader' }, false, 'https://external.example.org');
    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toMatch(/\/marketing\/forms\/newsletter\/thanks\?lang=/);
    expect((await request(result.headers.get('location') ?? '')).status).toBe(200);
    expect(await fixture.deps.contacts.findByEmail('directory-a', 'html@example.org')).toMatchObject({ displayName: 'HTML reader', source: 'form:newsletter', tags: ['signup'] });
  });
  it('returns identical JSON for new and existing emails and records each explicit submission', async () => {
    for (let count = 0; count < 2; count += 1) {
      const result = await submit('json@example.org', {}, true, 'https://embed.example.org');
      expect(result.status).toBe(200);
      expect(result.headers.get('access-control-allow-origin')).toBe('https://embed.example.org');
      expect(await result.json()).toEqual({ status: 'subscribed' });
    }
    expect(await fixture.deps.consents.listByEmail('directory-a', 'json@example.org')).toHaveLength(2);
  });
  it('silently discards honeypots and rejects invalid inputs and unsupported content types', async () => {
    expect((await submit('bot@example.org', { website: 'bot' })).status).toBe(200);
    expect(await fixture.deps.contacts.findByEmail('directory-a', 'bot@example.org')).toBeNull();
    expect((await submit('bad-address')).status).toBe(400);
    expect((await submit('name@example.org', { displayName: 'a'.repeat(121) })).status).toBe(400);
    expect((await submit('token@example.org', { token: 'invalid' })).status).toBe(400);
    expect((await request(submitPath, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415);
    expect((await submit('large@example.org', { displayName: 'a'.repeat(17_000) })).status).toBe(413);
  });
  it('enforces exact CORS origins before writes while allowing ordinary cross-site HTML forms', async () => {
    const preflight = await request(submitPath, { method: 'OPTIONS', headers: { origin: 'https://embed.example.org', 'access-control-request-method': 'POST' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://embed.example.org');
    expect((await request(submitPath, { method: 'OPTIONS', headers: { origin: 'https://blocked.example.org' } })).status).toBe(403);
    expect((await submit('blocked@example.org', {}, true, 'https://blocked.example.org')).status).toBe(403);
    expect(await fixture.deps.contacts.findByEmail('directory-a', 'blocked@example.org')).toBeNull();
  });
  it('keeps CORS headers on rejected JSON submissions from an allowed origin', async () => {
    const origin = 'https://embed.example.org';
    const invalid = await submit('not-an-address', {}, true, origin);
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('access-control-allow-origin')).toBe(origin);
    const unsupported = await request(submitPath, { method: 'POST', headers: { 'content-type': 'text/plain', origin }, body: '{}' });
    expect(unsupported.status).toBe(415);
    expect(unsupported.headers.get('access-control-allow-origin')).toBe(origin);
    const oversized = await submit('oversized@example.org', { displayName: 'a'.repeat(17_000) }, true, origin);
    expect(oversized.status).toBe(413);
    expect(oversized.headers.get('access-control-allow-origin')).toBe(origin);
  });
  it('accepts an adapted embed that posts extra fields', async () => {
    const result = await submit('extra-fields@example.org', { submit: 'Sign up', utm_source: 'blog' });
    expect(result.status).toBe(200);
    expect(await fixture.deps.contacts.findByEmail('directory-a', 'extra-fields@example.org')).toMatchObject({ source: 'form:newsletter' });
  });
  it('enforces email and IP limits', async () => {
    const limited = await request(submitPath, { method: 'POST', headers: { 'content-type': 'Application/X-Www-Form-Urlencoded', origin: 'https://embed.example.org' }, body: new URLSearchParams({ email: ' JSON@EXAMPLE.ORG ', token }) });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect(limited.headers.get('access-control-allow-origin')).toBe('https://embed.example.org');
    const restricted = buildApp({ ...deps, publicRateLimitPolicies: { ...deps.publicRateLimitPolicies, signupsPerIp: { limit: 1, windowMs: 60_000 } } });
    const result = await restricted.request(new Request(`https://${host}${submitPath}`, { method: 'POST', headers: { host, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ip-limit@example.org', token }) }));
    expect(result.status).toBe(429);
  });
  it('uses host tenant isolation and ignores tenant selection headers', async () => {
    const response = await request(submitPath, { method: 'POST', headers: { host: 'directory-b.example.org', 'x-tenant-id': 'directory-a', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'foreign@example.org', token }) });
    expect(response.status).toBe(404);
    expect(await fixture.deps.contacts.findByEmail('directory-a', 'foreign@example.org')).toBeNull();
  });
  it('exposes signup consent in the Studio contact API and counts submissions', async () => {
    const api = createApiClient({ baseUrl: `https://${host}`, fetchImpl: async (url, init) => {
      const headers = new Headers(init?.headers); headers.set('host', host);
      return app.request(new Request(url, { ...init, headers }));
    } });
    const contacts = directoryValue(await api.listMarketingContacts({ search: 'html@example.org', consentDefinitionId: 'newsletter', consentState: 'active' }));
    expect(contacts.contacts).toHaveLength(1);
    expect(contacts.contacts[0]).toMatchObject({ consentState: 'active', tags: ['signup'] });
    if (deps.marketingSignup === undefined) throw new Error('Signup forms are unavailable');
    const detail = directoryValue(await getMarketingSignupForm(directoryCtx(), { slug: 'newsletter' }, deps.marketingSignup));
    expect(detail.counters).toMatchObject({ confirmed: 4, pending: 0, submissions24h: 4, submissions7d: 4 });
  });
});


describe('signup lifecycle projections', () => {
  it('preserves confirmation counters when consent evidence is purged', async () => {
    if (deps.marketingSignup === undefined) throw new Error('Signup forms are unavailable');
    const base = await fixture.deps.definitions.findById('directory-a', 'newsletter');
    const version = (await fixture.deps.definitions.listVersions('directory-a', 'newsletter'))[0];
    if (base === null || version === undefined) throw new Error('Missing consent fixture');
    await fixture.deps.definitions.create('directory-a', { ...base, id: 'double', key: 'double', doubleOptIn: true }, { ...version, id: 'double-v1', definitionId: 'double' });
    const created = directoryValue(await createMarketingSignupForm(directoryCtx(), { slug: 'double', name: 'Double opt-in', consentDefinitionId: 'double', successText: { en: 'Thank you', pl: 'Thank you' } }, deps.marketingSignup));
    const result = await request('/api/public/marketing/forms/double/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'double@example.org', token: created.form.token }) });
    expect(await result.json()).toEqual({ status: 'pending' });
    const [consent] = await fixture.deps.consents.listByEmail('directory-a', 'double@example.org');
    if (consent === undefined) throw new Error('Missing pending consent');
    const confirmation = await signupConfirmationToken(fixture.db, 'directory-a', consent.id);
    const path = `/marketing/confirm/${confirmation}`;
    expect((await request(path)).status).toBe(200);
    expect(directoryValue(await getMarketingSignupForm(directoryCtx(), { slug: 'double' }, deps.marketingSignup)).counters).toMatchObject({ confirmed: 0, pending: 1 });
    expect((await request(path, { method: 'POST' })).status).toBe(200);
    expect(directoryValue(await getMarketingSignupForm(directoryCtx(), { slug: 'double' }, deps.marketingSignup)).counters).toMatchObject({ confirmed: 1, pending: 0 });
    await purgeSignupTestEvidence(fixture.db, 'directory-a', 'double');
    expect(directoryValue(await getMarketingSignupForm(directoryCtx(), { slug: 'double' }, deps.marketingSignup)).counters).toMatchObject({ submissionsTotal: 1, confirmed: 1, pending: 0 });
  });
  it('supports configured redirects and archives with revision conflict protection', async () => {
    if (deps.marketingSignup === undefined) throw new Error('Signup forms are unavailable');
    const input = { slug: 'redirect', name: 'Redirect', consentDefinitionId: 'newsletter', successText: { en: 'Thank you', pl: 'Thank you' }, redirectUrl: 'https://example.org/welcome' };
    const created = directoryValue(await createMarketingSignupForm(directoryCtx(), input, deps.marketingSignup));
    const page = await request('/marketing/forms/redirect');
    expect(page.headers.get('content-security-policy')).toContain("form-action 'self' https://example.org");
    const submitted = await request('/api/public/marketing/forms/redirect/submit', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'redirect@example.org', token: created.form.token }) });
    expect(submitted.status).toBe(303);
    expect(submitted.headers.get('location')).toBe(input.redirectUrl);
    expect(await updateMarketingSignupForm(directoryCtx(), { ...input, status: 'archived', expectedRevision: 1 }, deps.marketingSignup)).toMatchObject({ ok: true });
    expect((await request('/marketing/forms/redirect')).status).toBe(404);
    expect(await updateMarketingSignupForm(directoryCtx(), { ...input, expectedRevision: 1 }, deps.marketingSignup)).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });
});
