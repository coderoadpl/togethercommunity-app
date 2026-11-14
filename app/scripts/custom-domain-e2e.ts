import type { ChildProcess } from 'node:child_process';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../apps/web/src/i18n/en.js';

import { generate } from 'otplib';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { z } from 'zod';

import {
  AUTH_POLICY,
  BETTER_AUTH_MAGIC_LINK_PATH,
  BETTER_AUTH_SIGN_OUT_PATH,
  BETTER_AUTH_TWO_FACTOR_TOTP_PATH,
} from '#adapters/auth/create-auth.js';
import { AUTH_EMAIL_VERIFICATION_PATH } from '#adapters/auth/e2e-http.js';
import { uniqueTestDatabaseName } from '#adapters/db/test-database-name.js';
import { API_PATHS } from '#core/contract/index.js';
import { SMOKE_TENANT_CREATOR_EMAIL, SMOKE_TENANT_MEMBER_EMAIL } from '#core/domain/index.js';

import {
  bootServer,
  delay,
  ephemeralPort,
  killServer,
  rootDir,
  run,
  tsxBin,
} from './server-harness.js';
import { assertSafeE2eDatabaseReset, resolveE2eDatabaseUrl } from './e2e-config.js';
import { requestMagicLink, signInWithPassword } from './login-flow.js';
import { prepareWelcomePurchases, restrictBrowserToLocalRequests, runWelcomePurchases } from './purchase-welcome-e2e.js';

const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const chromeExecutablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];

const PLATFORM_BASE_DOMAIN = 'platform.localhost';
const CUSTOM_HOST = `course.acme.${PLATFORM_BASE_DOMAIN}`;
const CUSTOM_ORIGIN = `https://${CUSTOM_HOST}`;
const STUDIO_CUSTOM_HOST = `files.studio.${PLATFORM_BASE_DOMAIN}`;
const TENANT_HOST = `acme.${PLATFORM_BASE_DOMAIN}`;
const CREATOR_PASSWORD = 'demo-password-15';
const PROTECTED_LESSON_PATH = '/my/courses/course-acme/lessons/lesson-acme-intro';

const E2E_DB = uniqueTestDatabaseName('together_custom_domain_e2e');
const baseDatabaseUrl = resolveE2eDatabaseUrl(process.env);
assertSafeE2eDatabaseReset(baseDatabaseUrl, E2E_DB, process.env);
const e2eUrlObject = new URL(baseDatabaseUrl);
e2eUrlObject.pathname = `/${E2E_DB}`;
const e2eDatabaseUrl = e2eUrlObject.toString();

class E2eFailure extends Error {}
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new E2eFailure(message);
}

interface HostResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

const devMagicLinkSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    magicLink: z.object({
      email: z.string(),
      url: z.string().url(),
      token: z.string(),
    }).nullable(),
  }),
});

const authErrorSchema = z.object({ code: z.string() });

const devEmailSchema = z.object({
  ok: z.literal(true),
  data: z.object({ email: z.object({ text: z.string() }).nullable() }),
});

const verifiedMeSchema = z.object({
  ok: z.literal(true),
  data: z.object({ email: z.string(), emailVerified: z.boolean() }),
});

const meSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    email: z.string(),
    tenant: z.object({
      name: z.string(),
      memberId: z.string().nullable(),
    }).nullable(),
  }),
});

const parseJson = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

const setupDatabase = async (adminUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${E2E_DB}`);
  } catch (cause) {
    throw new E2eFailure(
      `Could not prepare the custom-domain-e2e database "${E2E_DB}". Is the dev Postgres up (pnpm run db:up)?\n${String(cause)}`,
    );
  } finally {
    await client.end();
  }
};

const dropDatabase = async (adminUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)`);
  } finally {
    await client.end();
  }
};

const attachCustomDomain = async (databaseUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO tenant_domains (id, tenant_id, domain, kind, verified)
       VALUES ($1, $2, $3, 'custom', true)
       ON CONFLICT (domain) DO UPDATE SET verified = true`,
      ['domain-acme-custom', 'tenant-acme', CUSTOM_HOST],
    );
    await client.query(
      `INSERT INTO tenant_domains (id, tenant_id, domain, kind, verified)
       VALUES ($1, $2, $3, 'custom', true)
       ON CONFLICT (domain) DO UPDATE SET verified = true`,
      ['domain-studio-custom', 'tenant-studio', STUDIO_CUSTOM_HOST],
    );
  } finally {
    await client.end();
  }
};

const migrateAndSeed = async (databaseUrl: string): Promise<void> => {
  const migrate = await run(tsxBin, ['adapters/db/migrate.ts'], { DATABASE_URL: databaseUrl });
  assert(migrate.code === 0, `Migration failed:\n${migrate.stdout}${migrate.stderr}`);
  const seed = await run(tsxBin, ['adapters/db/seed.ts'], { DATABASE_URL: databaseUrl });
  assert(seed.code === 0, `Seed failed:\n${seed.stdout}${seed.stderr}`);
};

const buildWeb = async (): Promise<void> => {
  const build = await run(viteBin, ['build', '--config', 'apps/web/vite.config.ts'], { APP_BASE_DOMAIN: PLATFORM_BASE_DOMAIN });
  assert(build.code === 0, `Web build failed:\n${build.stdout}${build.stderr}`);
};

const launchBrowser = (): Promise<Browser> => chromium.launch(
  chromeExecutablePath
    ? { executablePath: chromeExecutablePath, headless: true }
    : { channel: 'chrome', headless: true },
);

const sessionCookies = async (context: BrowserContext) =>
  (await context.cookies()).filter((cookie) => cookie.name.endsWith('session_token'));

const requestWithHost = (
  connectUrl: string,
  path: string,
  host: string,
  init: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<HostResponse> =>
  new Promise((resolve, reject) => {
    const target = new URL(path, connectUrl);
    const headers: Record<string, string> = { host, ...(init.headers ?? {}) };
    if (init.body !== undefined) headers['content-length'] = String(Buffer.byteLength(init.body));
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        method: init.method ?? 'GET',
        path: `${target.pathname}${target.search}`,
        headers,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body,
        }));
      },
    );
    request.on('error', reject);
    if (init.body !== undefined) request.write(init.body);
    request.end();
  });

const postMagicLink = async (
  connectUrl: string,
  input: { host: string; origin: string; email: string; callbackURL: string },
): Promise<HostResponse> =>
  requestWithHost(connectUrl, BETTER_AUTH_MAGIC_LINK_PATH, input.host, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: input.origin,
    },
    body: JSON.stringify({ email: input.email, callbackURL: input.callbackURL }),
  });

const readMagicLink = async (connectUrl: string, host: string, email: string): Promise<string> => {
  const response = await requestWithHost(
    connectUrl,
    `${API_PATHS.devMagicLink}?email=${encodeURIComponent(email)}`,
    host,
  );
  assert(response.status === 200, `dev magic-link read failed (HTTP ${response.status}): ${response.body}`);
  const parsed = devMagicLinkSchema.parse(parseJson(response.body));
  const magicLink = parsed.data.magicLink;
  assert(magicLink !== null, `no dev magic link was stored for ${email}`);
  return magicLink.url;
};

const setCookieValues = (headers: IncomingHttpHeaders): string[] => {
  const value = headers['set-cookie'];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
};

const sessionCookiePair = (headers: IncomingHttpHeaders): string => {
  const cookie = setCookieValues(headers).find((entry) =>
    entry.includes('better-auth.session_token=') && !entry.includes('Max-Age=0'));
  assert(cookie !== undefined, `magic-link callback did not set a session cookie: ${JSON.stringify(headers)}`);
  const pair = cookie.split(';')[0] ?? '';
  assert(pair.includes('='), `session cookie was malformed: ${cookie}`);
  return pair;
};

const addSessionCookie = async (
  context: BrowserContext,
  customBaseUrl: string,
  cookiePair: string,
): Promise<void> => {
  const separator = cookiePair.indexOf('=');
  assert(separator > 0, `session cookie pair was malformed: ${cookiePair}`);
  await context.addCookies([{
    name: cookiePair.slice(0, separator),
    value: cookiePair.slice(separator + 1),
    url: customBaseUrl,
    httpOnly: true,
    secure: false,
  }]);
};

const followMagicLinkWithHost = async (
  connectUrl: string,
  link: string,
): Promise<HostResponse> => {
  const url = new URL(link);
  return requestWithHost(connectUrl, `${url.pathname}${url.search}`, CUSTOM_HOST);
};

const runCustomHostSignIn = async (customBaseUrl: string, tenantBaseUrl: string): Promise<void> => {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext();
    await restrictBrowserToLocalRequests(context);
    const page = await context.newPage();

    await page.goto(`${customBaseUrl}/login`, { waitUntil: 'networkidle' });
    await signInWithPassword(page, SMOKE_TENANT_CREATOR_EMAIL, CREATOR_PASSWORD);
    await page.waitForURL('**/start', { timeout: 20000 });
    await page.goto(`${customBaseUrl}/panel`, { waitUntil: 'networkidle' });
    await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 20000 });
    assert(
      (await page.getByTestId('tenant-name').textContent()) === 'Acme Courses',
      'the custom domain did not open the Acme workspace',
    );

    const cookies = await sessionCookies(context);
    assert(cookies.length === 1, `expected one session cookie, saw ${cookies.length}`);
    assert(
      cookies[0]?.domain === CUSTOM_HOST,
      `session cookie escaped the custom host: ${String(cookies[0]?.domain)}`,
    );

    await page.goto(`${tenantBaseUrl}/panel`, { waitUntil: 'networkidle' });
    await page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 20000 });
    console.log('custom-domain-e2e: password sign-in scoped to the custom host OK');
    await context.close();
  } finally {
    if (browser) await browser.close();
  }
};

const runCrossTenantVisitor = async (tenantBaseUrl: string): Promise<void> => {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext();
    await restrictBrowserToLocalRequests(context);
    const page = await context.newPage();
    await page.goto(`${tenantBaseUrl}/login`, { waitUntil: 'networkidle' });
    await signInWithPassword(page, SMOKE_TENANT_CREATOR_EMAIL, CREATOR_PASSWORD);
    await page.waitForURL('**/start', { timeout: 20000 });
    const cookies = await sessionCookies(context);
    assert(cookies.some((cookie) => cookie.domain === `.${PLATFORM_BASE_DOMAIN}`), 'platform sign-in did not share its session cookie');
    const foreignOrigin = new URL(tenantBaseUrl);
    foreignOrigin.hostname = `studio.${PLATFORM_BASE_DOMAIN}`;
    for (const path of ['/', '/panel']) {
      await page.goto(new URL(path, foreignOrigin).href, { waitUntil: 'networkidle' });
      await page.getByTestId('foreign-tenant-notice').waitFor({ state: 'visible', timeout: 20000 });
      assert(new URL(page.url()).pathname === '/', 'foreign studio entry did not redirect home');
      await page.getByRole('heading', { name: en.anon.homeTitle, exact: true }).waitFor({ state: 'visible' });
      assert(await page.getByText(en.errors.messageForbidden, { exact: true }).count() === 0, 'visitor entry showed a permission error');
      assert(await page.getByTestId('foreign-tenant-notice').textContent().then((text) => text?.includes(SMOKE_TENANT_CREATOR_EMAIL) === true), 'visitor notice omitted the signed-in account');
      await page.getByRole('banner').getByRole('link', { name: en.auth.signInLink, exact: true }).waitFor({ state: 'visible' });
      const me = await page.request.get(new URL(API_PATHS.me, foreignOrigin).href);
      assert(me.status() === 200, 'foreign-host /api/me did not return 200');
      const identity = z.object({ data: z.object({ tenantAccess: z.literal('none'), tenant: z.null() }) }).safeParse(await me.json());
      assert(identity.success, 'foreign-host identity did not resolve as a visitor');
    }
    await page.getByRole('link', { name: en.tenant.visitorOwnCommunity }).click();
    await page.getByRole('link', { name: /Acme Courses/u }).waitFor({ state: 'visible', timeout: 20000 });
    await page.goto(foreignOrigin.href, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: en.tenant.visitorSwitchAccount }).click();
    try {
      await page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 20000 });
    } catch (cause) {
      throw new E2eFailure(`Account switch failed at ${page.url()}: ${await page.locator('body').innerText()}\n${String(cause)}`);
    }
    assert((await sessionCookies(context)).length === 0, 'switching accounts retained the shared session');
    console.log('custom-domain-e2e: shared session falls back to a foreign-tenant visitor OK');
    await context.close();
  } finally {
    await browser.close();
  }
};

const runCustomHostPasskey = async (customBaseUrl: string): Promise<void> => {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext();
    await restrictBrowserToLocalRequests(context);
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log(`  [browser:pageerror] ${error.message}`));
    await page.addInitScript(
      "Object.defineProperty(PublicKeyCredential, 'isConditionalMediationAvailable', { configurable: true, value: () => Promise.resolve(false) })",
    );
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    await page.goto(`${customBaseUrl}/login`, { waitUntil: 'networkidle' });
    await signInWithPassword(page, SMOKE_TENANT_CREATOR_EMAIL, CREATOR_PASSWORD);
    await page.waitForURL('**/start', { timeout: 20000 });
    await page.goto(`${customBaseUrl}/panel`, { waitUntil: 'networkidle' });
    await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 20000 });

    await page.getByTestId('section-settings').click();
    await page.getByRole('tab', { name: en.settingsNavigation.security }).click();
    await page.waitForURL(/#security$/);
    await page.getByTestId('passkey-name').fill('Custom Domain Passkey');
    await page.getByTestId('passkey-proof-password').fill(CREATOR_PASSWORD);
    await page.getByTestId('add-passkey').click();
    try {
      await page.locator('[data-testid^="toast-success-"]').first().waitFor({ state: 'visible', timeout: 20000 });
    } catch (cause) {
      const alert = await page.getByRole('alert').first().textContent().catch(() => null);
      throw new E2eFailure(
        `passkey registration on the custom host did not confirm. alert=${String(alert)}\n${String(cause)}`,
      );
    }

    await page.getByTestId('user-menu').click();
    await page.getByTestId('sign-out').click();
    await page.getByTestId('signin-passkey').waitFor({ state: 'visible', timeout: 20000 });
    await page.getByTestId('signin-passkey').click();
    await page.waitForURL('**/start', { timeout: 20000 });
    await page.goto(`${customBaseUrl}/panel`, { waitUntil: 'networkidle' });
    await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 20000 });
    assert(
      (await page.getByTestId('tenant-name').textContent()) === 'Acme Courses',
      'passkey sign-in on the custom host did not open the Acme workspace',
    );
    console.log('custom-domain-e2e: passkey ceremony on the custom host OK');
    await context.close();
  } finally {
    if (browser) await browser.close();
  }
};

const runCustomDomainMagicLink = async (
  connectUrl: string,
  tenantBaseUrl: string,
): Promise<void> => {
  const customOrigin = CUSTOM_ORIGIN;
  const callbackURL = `${customOrigin}/login?verification=verified`;
  const request = await postMagicLink(connectUrl, {
    host: CUSTOM_HOST,
    origin: customOrigin,
    email: SMOKE_TENANT_MEMBER_EMAIL,
    callbackURL,
  });
  assert(request.status === 200, `custom-domain magic-link request failed (HTTP ${request.status}): ${request.body}`);

  const link = await readMagicLink(connectUrl, CUSTOM_HOST, SMOKE_TENANT_MEMBER_EMAIL);
  const linkUrl = new URL(link);
  assert(linkUrl.origin === customOrigin, `magic-link origin was ${linkUrl.origin}, expected ${customOrigin}`);
  assert(
    linkUrl.origin !== new URL(tenantBaseUrl).origin,
    `magic-link origin fell back to the tenant subdomain: ${link}`,
  );

  const verified = await followMagicLinkWithHost(connectUrl, link);
  assert(verified.status === 302, `custom-domain magic-link callback returned HTTP ${verified.status}: ${verified.body}`);
  const location = verified.headers.location;
  assert(location !== undefined, 'custom-domain magic-link callback did not redirect');
  assert(
    new URL(location, customOrigin).origin === customOrigin,
    `custom-domain magic-link callback redirected outside the custom origin: ${location}`,
  );

  const cookie = sessionCookiePair(verified.headers);
  const me = await requestWithHost(connectUrl, API_PATHS.me, CUSTOM_HOST, {
    headers: { cookie },
  });
  assert(me.status === 200, `custom-domain session did not authorize /api/me (HTTP ${me.status}): ${me.body}`);
  const parsed = meSchema.parse(parseJson(me.body));
  assert(parsed.data.email === SMOKE_TENANT_MEMBER_EMAIL, `custom-domain session resolved ${parsed.data.email}`);
  assert(parsed.data.tenant?.name === 'Acme Courses', 'custom-domain session did not resolve the Acme tenant');
  assert(parsed.data.tenant.memberId !== null, 'custom-domain session did not resolve a member identity');
  console.log('custom-domain-e2e: custom-domain-magic-link OK');
};

const runCustomDomainMagicLinkCrossOriginRejected = async (
  connectUrl: string,
  tenantBaseUrl: string,
): Promise<void> => {
  const response = await postMagicLink(connectUrl, {
    host: CUSTOM_HOST,
    origin: CUSTOM_ORIGIN,
    email: SMOKE_TENANT_MEMBER_EMAIL,
    callbackURL: `${tenantBaseUrl}/login?verification=verified`,
  });
  assert(response.status === 400, `cross-origin magic-link request returned HTTP ${response.status}: ${response.body}`);
  const parsed = authErrorSchema.parse(parseJson(response.body));
  assert(
    parsed.code === 'INVALID_MAGIC_LINK_CALLBACK_ORIGIN',
    `cross-origin magic-link request returned ${parsed.code}`,
  );
  console.log('custom-domain-e2e: custom-domain-magic-link-cross-origin-rejected OK');
};

const runCustomDomainReturnTo = async (
  connectUrl: string,
  customBaseUrl: string,
): Promise<void> => {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext();
    await restrictBrowserToLocalRequests(context);
    const page = await context.newPage();
    await page.goto(`${customBaseUrl}${PROTECTED_LESSON_PATH}`, { waitUntil: 'networkidle' });
    await page.waitForURL(
      (url) =>
        url.origin === new URL(customBaseUrl).origin &&
        url.pathname === '/login' &&
        url.searchParams.get('returnTo') === PROTECTED_LESSON_PATH,
      { timeout: 20000 },
    );
    await requestMagicLink(page, SMOKE_TENANT_MEMBER_EMAIL);
    const devLink = page.getByTestId('open-magic-link');
    await devLink.waitFor({ state: 'visible', timeout: 20000 });
    const href = await devLink.getAttribute('href');
    assert(href !== null, 'returnTo dev magic link was missing');

    const verified = await followMagicLinkWithHost(connectUrl, href);
    assert(verified.status === 302, `returnTo magic-link callback returned HTTP ${verified.status}: ${verified.body}`);
    const location = verified.headers.location;
    assert(location !== undefined, 'returnTo magic-link callback did not redirect');
    const callback = new URL(location, customBaseUrl);
    assert(
      callback.origin === new URL(customBaseUrl).origin,
      `returnTo magic-link callback left the custom host: ${location}`,
    );
    await addSessionCookie(context, customBaseUrl, sessionCookiePair(verified.headers));
    await page.goto(callback.toString(), { waitUntil: 'networkidle' });
    await page.waitForURL(
      (url) => url.origin === new URL(customBaseUrl).origin && url.pathname === PROTECTED_LESSON_PATH,
      { timeout: 20000 },
    );
    assert(
      page.url() === `${customBaseUrl}${PROTECTED_LESSON_PATH}`,
      `custom-domain returnTo landed at ${page.url()}`,
    );
    console.log('custom-domain-e2e: custom-domain-return-to OK');
    await context.close();
  } finally {
    if (browser) await browser.close();
  }
};

const readVerificationLink = async (connectUrl: string, email: string): Promise<URL> => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const response = await fetch(new URL(`${API_PATHS.devEmail}?to=${encodeURIComponent(email)}`, connectUrl));
    assert(response.ok, `dev email read failed (HTTP ${response.status})`);
    const parsed = devEmailSchema.parse(await response.json());
    const candidate = parsed.data.email?.text.match(/https?:\/\/\S+/gu)
      ?.map((match) => new URL(match))
      .find((url) => url.pathname === AUTH_EMAIL_VERIFICATION_PATH);
    if (candidate !== undefined) return candidate;
    await delay(100);
  }
  throw new E2eFailure(`no verification email arrived for ${email}`);
};

const currentTotp = async (secret: string): Promise<string> => {
  const periodMilliseconds = AUTH_POLICY.totpPeriodSeconds * 1000;
  const remainingMilliseconds = periodMilliseconds - (Date.now() % periodMilliseconds);
  if (remainingMilliseconds < 5000) await delay(remainingMilliseconds + 100);
  return generate({ secret, digits: AUTH_POLICY.totpDigits, period: AUTH_POLICY.totpPeriodSeconds });
};

const readIdentity = async (context: BrowserContext, customBaseUrl: string) => {
  const response = await context.request.get(`${customBaseUrl}${API_PATHS.me}`);
  if (response.status() === 401) return null;
  assert(response.status() === 200, `custom-host /api/me returned HTTP ${response.status()}`);
  return verifiedMeSchema.parse(await response.json()).data;
};

const markEmailUnverified = async (databaseUrl: string, email: string): Promise<void> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query('UPDATE "user" SET email_verified = false WHERE email = $1', [email]);
    assert(result.rowCount === 1, `could not reset email verification for ${email}`);
  } finally {
    await client.end();
  }
};

const runCustomDomainVerificationTwoFactor = async (
  connectUrl: string,
  customBaseUrl: string,
  tenantBaseUrl: string,
): Promise<void> => {
  const email = 'verification-two-factor-e2e@together.dev';
  const password = 'verification-password-15';
  const returnTo = '/account?tab=security';
  const customHostOrigin = new URL(customBaseUrl).origin;
  const challengeUrl = new URL(
    `/login?${new URLSearchParams({ twoFactor: 'required', verification: 'verified', returnTo }).toString()}`,
    customBaseUrl,
  ).toString();
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext();
    await restrictBrowserToLocalRequests(context);
    const page = await context.newPage();

    await page.goto(`${customBaseUrl}/register?${new URLSearchParams({ returnTo }).toString()}`, { waitUntil: 'networkidle' });
    await page.getByLabel(en.auth.nameLabel, { exact: true }).fill('Verification Two-Factor');
    await page.getByLabel(en.auth.emailLabel, { exact: true }).fill(email);
    await page.getByLabel(en.auth.passwordLabel, { exact: true }).fill(password);
    await page.getByRole('button', { name: en.auth.createAccount, exact: true }).click();
    await page.getByRole('heading', { name: en.auth.registeredTitle, exact: true }).waitFor({
      state: 'visible', timeout: 20000,
    });
    const registered = await readIdentity(context, customBaseUrl);
    assert(registered?.email === email, 'custom-host sign-up did not create a session');
    assert(!registered.emailVerified, 'custom-host sign-up was verified before the link was opened');
    const link = await readVerificationLink(connectUrl, email);
    assert(link.origin === CUSTOM_ORIGIN, `verification link origin was ${link.origin}, expected ${CUSTOM_ORIGIN}`);
    const callback = link.searchParams.get('callbackURL');
    assert(
      callback !== null && new URL(callback).origin === customHostOrigin,
      `verification callback left the custom host: ${String(callback)}`,
    );
    const callbackUrl = new URL(callback);
    assert(
      callbackUrl.pathname === '/login'
        && callbackUrl.searchParams.get('verification') === 'verified'
        && callbackUrl.searchParams.get('returnTo') === returnTo,
      `verification callback did not carry the sign-up returnTo: ${callback}`,
    );

    await page.goto(`${customBaseUrl}${returnTo}`, { waitUntil: 'networkidle' });
    await page.getByTestId('enable-2fa-open').click();
    await page.getByTestId('enable-2fa-password').fill(password);
    await page.getByTestId('enable-2fa').click();
    await page.getByTestId('two-factor-manual-setup').click();
    const totpUri = await page.getByTestId('totp-uri').textContent();
    assert(totpUri !== null, 'two-factor enrollment did not return an authenticator URI');
    const secret = new URL(totpUri).searchParams.get('secret');
    assert(secret !== null, 'two-factor enrollment did not return an authenticator secret');
    await page.getByTestId('two-factor-next').click();
    await page.getByTestId('verify-totp-code').fill(await currentTotp(secret));
    await page.getByTestId('backup-codes').waitFor({ state: 'visible', timeout: 20000 });
    await page.getByRole('checkbox', { name: en.security.backupCodesSaved }).check();
    await page.getByTestId('two-factor-finish').click();
    await page.getByTestId('two-factor-done-close').click();
    await page.getByTestId('two-factor-manage').waitFor({ state: 'visible', timeout: 20000 });

    const signOut = async (): Promise<void> => {
      const signedOut = await context.request.post(`${customBaseUrl}${BETTER_AUTH_SIGN_OUT_PATH}`, {
        headers: { origin: customHostOrigin },
        data: {},
      });
      assert(signedOut.ok(), `custom-host sign-out failed (HTTP ${signedOut.status()})`);
      assert((await sessionCookies(context)).length === 0, 'sign-out left a session cookie behind');
      assert(await readIdentity(context, customBaseUrl) === null, 'sign-out left the session usable');
    };

    const openLinkToChallenge = async (callbackURL: string): Promise<void> => {
      const browserLink = new URL(`${link.pathname}${link.search}`, customBaseUrl);
      browserLink.searchParams.set('callbackURL', callbackURL);
      const verificationResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === AUTH_EMAIL_VERIFICATION_PATH);
      await page.goto(browserLink.toString(), { waitUntil: 'networkidle' });
      const verified = await verificationResponse;
      assert(verified.status() === 302, `verification link with callback ${callbackURL} returned HTTP ${verified.status()}`);
      assert(
        verified.headers()['location'] === challengeUrl,
        `verification link with callback ${callbackURL} redirected to ${String(verified.headers()['location'])} instead of ${challengeUrl}`,
      );
      await page.waitForURL(
        (url) =>
          url.origin === customHostOrigin
          && url.pathname === '/login'
          && url.searchParams.get('twoFactor') === 'required'
          && url.searchParams.get('returnTo') === returnTo,
        { timeout: 20000 },
      );
      await page.getByTestId('two-factor-challenge').waitFor({ state: 'visible', timeout: 20000 });

      assert((await sessionCookies(context)).length === 0, 'verification set a session cookie before the TOTP step');
      assert(await readIdentity(context, customBaseUrl) === null, 'verification signed in before the TOTP step');
      const challengeCookies = (await context.cookies()).filter((cookie) => cookie.name.endsWith('two_factor'));
      assert(
        challengeCookies.length === 1 && challengeCookies[0]?.domain === CUSTOM_HOST,
        `the two-factor challenge cookie was not host-only on the custom host: ${JSON.stringify(challengeCookies)}`,
      );
    };

    const completeChallenge = async (): Promise<void> => {
      await page.getByTestId('two-factor-code').fill(await currentTotp(secret));
      const completion = page.waitForResponse((response) =>
        new URL(response.url()).pathname === BETTER_AUTH_TWO_FACTOR_TOTP_PATH);
      await page.getByTestId('verify-login-totp').click();
      const completed = await completion;
      assert(completed.status() === 200, `TOTP completion returned HTTP ${completed.status()}`);
      try {
        await page.waitForURL(
          (url) =>
            url.origin === customHostOrigin
            && url.pathname === '/account'
            && url.searchParams.get('tab') === 'security',
          { timeout: 20000 },
        );
      } catch (cause) {
        throw new E2eFailure(`TOTP completion did not continue to ${returnTo}: landed at ${page.url()}\n${String(cause)}`);
      }
      const identity = await readIdentity(context, customBaseUrl);
      assert(identity?.email === email, 'TOTP completion did not sign the verified account in');
      assert(identity.emailVerified, 'the session after TOTP completion is not verified');
      const cookies = await sessionCookies(context);
      assert(
        cookies.length === 1 && cookies[0]?.domain === CUSTOM_HOST,
        `the session cookie after TOTP completion escaped the custom host: ${JSON.stringify(cookies.map((cookie) => cookie.domain))}`,
      );
    };

    await signOut();
    await openLinkToChallenge(callback);
    await completeChallenge();
    console.log('custom-domain-e2e: email verification with two-factor challenged on the custom host OK');

    await signOut();
    // Better Auth issues the two-factor challenge only while the account is still unverified.
    await markEmailUnverified(e2eDatabaseUrl, email);
    const tenantCallback = new URL(`/login?${new URLSearchParams({ verification: 'verified', returnTo }).toString()}`, tenantBaseUrl);
    await openLinkToChallenge(tenantCallback.toString());
    await completeChallenge();
    console.log('custom-domain-e2e: a workspace-subdomain verification callback stays challenged on the custom host OK');
    await context.close();
  } finally {
    if (browser) await browser.close();
  }
};

const SELF_SERVE_HOST = 'shop.acme.example';

const readDomainRow = async (
  databaseUrl: string,
  domain: string,
): Promise<{ verified: boolean; provider: string; kind: string } | null> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ verified: boolean; provider: string; kind: string }>(
      'SELECT verified, provider, kind FROM tenant_domains WHERE domain = $1',
      [domain],
    );
    return result.rows[0] ?? null;
  } finally {
    await client.end();
  }
};

const verifyDomainRow = async (databaseUrl: string, domain: string): Promise<void> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      'UPDATE tenant_domains SET verified = true, verified_at = now() WHERE domain = $1',
      [domain],
    );
  } finally {
    await client.end();
  }
};

/** Node's fetch drops a custom Host header, and the domain has no DNS record. */
const getWithHost = (connectUrl: string, path: string, host: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const target = new URL(path, connectUrl);
    const request = httpRequest(
      { hostname: target.hostname, port: target.port, path: target.pathname, headers: { host } },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => resolve(body));
      },
    );
    request.on('error', reject);
    request.end();
  });

const resolveTenantThroughHost = async (
  connectUrl: string,
  host: string,
): Promise<string | null> => {
  const body = await getWithHost(connectUrl, '/api/public/offer', host);
  const parsed = z
    .object({ ok: z.literal(true), data: z.object({ tenant: z.object({ name: z.string() }) }) })
    .safeParse(JSON.parse(body));
  return parsed.success ? parsed.data.data.tenant.name : null;
};

const runSelfServeAdd = async (input: {
  tenantBaseUrl: string;
  connectUrl: string;
  databaseUrl: string;
}): Promise<void> => {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext();
    await restrictBrowserToLocalRequests(context);
    const page = await context.newPage();
    await page.goto(`${input.tenantBaseUrl}/login`, { waitUntil: 'networkidle' });
    await signInWithPassword(page, SMOKE_TENANT_CREATOR_EMAIL, CREATOR_PASSWORD);
    await page.waitForURL('**/start', { timeout: 20000 });
    await page.goto(`${input.tenantBaseUrl}/panel`, { waitUntil: 'networkidle' });
    await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 20000 });
    await page.goto(`${input.tenantBaseUrl}/panel/settings#company`, { waitUntil: 'networkidle' });

    await page.getByTestId('tenant-domain-input').fill(`shop.acme.${PLATFORM_BASE_DOMAIN}`);
    await page.getByTestId('tenant-domain-add').click();
    await page.locator('[data-testid^="toast-error-"]').first().waitFor({ state: 'visible', timeout: 20000 });
    assert(
      await readDomainRow(input.databaseUrl, `shop.acme.${PLATFORM_BASE_DOMAIN}`) === null,
      'the platform base domain was accepted as a custom domain',
    );
    console.log('custom-domain-e2e: self-serve add refused a platform subdomain OK');

    await page.getByTestId('tenant-domain-input').fill(SELF_SERVE_HOST);
    await page.getByTestId('tenant-domain-add').click();
    const row = page.getByTestId(`tenant-domain-${SELF_SERVE_HOST}`);
    await row.waitFor({ state: 'visible', timeout: 20000 });
    assert(
      (await row.textContent())?.includes('Waiting for DNS') === true,
      'a self-serve domain did not land in the pending state',
    );

    const pending = await readDomainRow(input.databaseUrl, SELF_SERVE_HOST);
    assert(
      pending?.verified === false && pending.provider === 'manual' && pending.kind === 'custom',
      `manual mode stored an unexpected row: ${JSON.stringify(pending)}`,
    );
    console.log('custom-domain-e2e: self-serve add stored a pending manual row OK');

    await verifyDomainRow(input.databaseUrl, SELF_SERVE_HOST);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId(`tenant-domain-status-${SELF_SERVE_HOST}`).waitFor({
      state: 'visible',
      timeout: 20000,
    });
    assert(
      (await page.getByTestId(`tenant-domain-status-${SELF_SERVE_HOST}`).textContent()) === en.tenantDomains.statusActive,
      'the Studio did not show the operator-verified domain as active',
    );

    const resolved = await resolveTenantThroughHost(input.connectUrl, SELF_SERVE_HOST);
    assert(
      resolved === 'Acme Courses',
      `the self-serve host did not resolve the Acme workspace: ${String(resolved)}`,
    );
    console.log('custom-domain-e2e: operator flip made the self-serve host resolve OK');

    await page.goto(`${input.tenantBaseUrl}/panel/settings#company`, { waitUntil: 'networkidle' });
    await page.getByTestId(`tenant-domain-remove-${SELF_SERVE_HOST}`).click();
    await page.getByTestId('tenant-domain-remove-confirm').click();
    await row.waitFor({ state: 'detached', timeout: 20000 });
    assert(
      await readDomainRow(input.databaseUrl, SELF_SERVE_HOST) === null,
      'removing the domain left its row behind',
    );
    console.log('custom-domain-e2e: self-serve removal deleted the row OK');
    await context.close();
  } finally {
    if (browser) await browser.close();
  }
};

const runStudioDomainStatus = async (tenantBaseUrl: string): Promise<void> => {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext();
    await restrictBrowserToLocalRequests(context);
    const page = await context.newPage();
    await page.goto(`${tenantBaseUrl}/login`, { waitUntil: 'networkidle' });
    await signInWithPassword(page, SMOKE_TENANT_CREATOR_EMAIL, CREATOR_PASSWORD);
    await page.waitForURL('**/start', { timeout: 20000 });
    await page.goto(`${tenantBaseUrl}/panel`, { waitUntil: 'networkidle' });
    await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 20000 });
    await page.goto(`${tenantBaseUrl}/panel/settings#company`, { waitUntil: 'networkidle' });
    const row = page.getByTestId(`tenant-domain-${CUSTOM_HOST}`);
    await row.waitFor({ state: 'visible', timeout: 20000 });
    assert(
      (await row.textContent())?.includes(CUSTOM_HOST) === true,
      'the settings page did not list the custom domain',
    );
    console.log('custom-domain-e2e: studio domain status OK');
    await context.close();
  } finally {
    if (browser) await browser.close();
  }
};

const startedAt = Date.now();
let server: ChildProcess | null = null;
try {
  console.log('custom-domain-e2e: preparing isolated database...');
  await setupDatabase(baseDatabaseUrl);
  await migrateAndSeed(e2eDatabaseUrl);
  await prepareWelcomePurchases(e2eDatabaseUrl);
  await attachCustomDomain(e2eDatabaseUrl);
  console.log('custom-domain-e2e: building the web SPA...');
  await buildWeb();
  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${port}`;
  const tenantBaseUrl = `http://${TENANT_HOST}:${port}`;
  const customBaseUrl = `http://${CUSTOM_HOST}:${port}`;
  console.log(`custom-domain-e2e: booting server on port ${port}...`);
  server = await bootServer({
    port,
    healthUrl: `${connectUrl}/api/health`,
    env: {
      DATABASE_URL: e2eDatabaseUrl,
      APP_BASE_URL: tenantBaseUrl,
      APP_BASE_DOMAIN: PLATFORM_BASE_DOMAIN,
      WEB_DIST_DIR: 'dist/web',
      AUTH_DEV_EXPOSE_MAGIC_LINKS: 'true',
      EMAIL_PROVIDER: 'dev',
      SIMULATED_PAYMENTS: 'true',
    },
  });
  await runCrossTenantVisitor(tenantBaseUrl);
  await runCustomHostSignIn(customBaseUrl, tenantBaseUrl);
  await runCustomHostPasskey(customBaseUrl);
  await runCustomDomainMagicLink(connectUrl, tenantBaseUrl);
  await runCustomDomainMagicLinkCrossOriginRejected(connectUrl, tenantBaseUrl);
  await runCustomDomainReturnTo(connectUrl, customBaseUrl);
  await runCustomDomainVerificationTwoFactor(connectUrl, customBaseUrl, tenantBaseUrl);
  const studioBaseUrl = `http://${STUDIO_CUSTOM_HOST}:${port}`;
  const studioOrigin = `https://${STUDIO_CUSTOM_HOST}`;
  await runWelcomePurchases({
    connectUrl,
    webBaseUrl: studioBaseUrl,
    canonicalOrigin: studioOrigin,
    verify: async (context, link) => {
      const url = new URL(link);
      const verified = await requestWithHost(connectUrl, `${url.pathname}${url.search}`, STUDIO_CUSTOM_HOST);
      assert(verified.status === 302, `welcome verification returned HTTP ${verified.status}: ${verified.body}`);
      const location = verified.headers.location;
      assert(location === url.searchParams.get('callbackURL'), `welcome verification changed its callback: ${String(location)}`);
      assert(location !== undefined, 'welcome verification did not redirect');
      await addSessionCookie(context, studioBaseUrl, sessionCookiePair(verified.headers));
      return new URL(new URL(location).pathname, studioBaseUrl).toString();
    },
  });
  await runStudioDomainStatus(tenantBaseUrl);
  await runSelfServeAdd({ tenantBaseUrl, connectUrl, databaseUrl: e2eDatabaseUrl });
  console.log(`\ncustom-domain-e2e: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof E2eFailure ? error.message : String(error);
  console.error(`\ncustom-domain-e2e: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server) await killServer(server);
  rmSync(webDistDir, { recursive: true, force: true });
  await dropDatabase(baseDatabaseUrl);
}
