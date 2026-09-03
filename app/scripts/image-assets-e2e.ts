import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { join } from 'node:path';

import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { z } from 'zod';
import type { ZodTypeAny, output } from 'zod';

import {
  API_PATHS,
  imageAssetCompleteOutputSchema,
  imageAssetUploadOutputSchema,
  looseEnvelopeSchema,
} from '#core/contract/index.js';
import { IMAGE_ASSET_MAX_BYTES } from '#core/domain/index.js';

import { resolveE2eDatabaseUrl } from './e2e-config.js';
import { requestMagicLink, signInWithPassword } from './login-flow.js';
import {
  bootServer,
  delay,
  ephemeralPort,
  killServer,
  rootDir,
  run,
  tsxBin,
} from './server-harness.js';

const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const chromeExecutablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];
const E2E_DB = 'together_e2e_image_assets';
const baseDatabaseUrl = resolveE2eDatabaseUrl(process.env);
const e2eUrlObject = new URL(baseDatabaseUrl);
e2eUrlObject.pathname = `/${E2E_DB}`;
const e2eDatabaseUrl = e2eUrlObject.toString();
const minioContainer = `together-image-assets-e2e-${randomUUID()}`;
const bucket = 'together-image-assets-e2e';
const accessKeyId = 'together-e2e';
const secretAccessKey = 'together-e2e-secret';
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4z8DwHwAFgAH/iZk9HQAAAABJRU5ErkJggg==';
const visible = { state: 'visible', timeout: 15000 } as const;
let minioCertificateDirectory: string | null = null;

class E2eFailure extends Error {}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new E2eFailure(message);
}

const setupDatabase = async (adminUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${E2E_DB}`);
  } catch (cause) {
    throw new E2eFailure(
      `Could not prepare the image-assets database "${E2E_DB}". Is the dev Postgres up (pnpm run db:up)?\n${String(cause)}`,
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

const migrateAndSeed = async (databaseUrl: string): Promise<void> => {
  const migrate = await run(tsxBin, ['adapters/db/migrate.ts'], { DATABASE_URL: databaseUrl });
  assert(migrate.code === 0, `Migration failed:\n${migrate.stdout}${migrate.stderr}`);
  const seed = await run(tsxBin, ['adapters/db/seed.ts'], { DATABASE_URL: databaseUrl });
  assert(seed.code === 0, `Seed failed:\n${seed.stdout}${seed.stderr}`);
};

const buildWeb = async (): Promise<void> => {
  const build = await run(viteBin, ['build', '--config', 'apps/web/vite.config.ts'], {});
  assert(build.code === 0, `Web build failed:\n${build.stdout}${build.stderr}`);
};

const expectRun = (result: Awaited<ReturnType<typeof run>>, label: string): void => {
  assert(result.code === 0, `${label} failed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
};

const minioHealthStatus = (endpoint: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const request = httpsGet(
      `${endpoint}/minio/health/live`,
      { rejectUnauthorized: false },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on('error', reject);
  });

interface MinioRuntime {
  endpoint: string;
  certificatePath: string;
}

const startMinio = async (port: number, studioOrigin: string): Promise<MinioRuntime> => {
  const endpoint = `https://127.0.0.1:${String(port)}`;
  minioCertificateDirectory = mkdtempSync(join(rootDir, '.image-assets-tls-'));
  const certificatePath = join(minioCertificateDirectory, 'public.crt');
  const privateKeyPath = join(minioCertificateDirectory, 'private.key');
  expectRun(
    await run('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-sha256',
      '-days',
      '1',
      '-nodes',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1,DNS:localhost',
      '-keyout',
      privateKeyPath,
      '-out',
      certificatePath,
    ]),
    'MinIO TLS certificate generation',
  );
  await run('docker', ['rm', '-f', minioContainer]);
  expectRun(
    await run('docker', [
      'run',
      '--rm',
      '-d',
      '--name',
      minioContainer,
      '-e',
      `MINIO_ROOT_USER=${accessKeyId}`,
      '-e',
      `MINIO_ROOT_PASSWORD=${secretAccessKey}`,
      '-e',
      `MINIO_API_CORS_ALLOW_ORIGIN=${studioOrigin}`,
      '-v',
      `${minioCertificateDirectory}:/certs:ro`,
      '-p',
      `${String(port)}:9000`,
      'minio/minio',
      'server',
      '--certs-dir',
      '/certs',
      '/data',
    ]),
    'MinIO startup',
  );

  const deadline = Date.now() + 60000;
  let ready = false;
  let lastError = '';
  while (Date.now() < deadline && !ready) {
    try {
      const status = await minioHealthStatus(endpoint);
      ready = status === 200;
      if (!ready) lastError = `HTTP ${String(status)}`;
    } catch (cause) {
      lastError = String(cause);
    }
    if (!ready) await delay(250);
  }
  if (!ready) {
    const logs = await run('docker', ['logs', minioContainer]);
    throw new E2eFailure(
      `MinIO did not become ready at ${endpoint}.\n${lastError}\n${logs.stdout}${logs.stderr}`,
    );
  }

  expectRun(
    await run('docker', [
      'exec',
      minioContainer,
      'mc',
      '--insecure',
      'alias',
      'set',
      'local',
      'https://127.0.0.1:9000',
      accessKeyId,
      secretAccessKey,
    ]),
    'MinIO alias setup',
  );
  expectRun(
    await run('docker', ['exec', minioContainer, 'mc', '--insecure', 'mb', '--ignore-existing', `local/${bucket}`]),
    'MinIO bucket creation',
  );
  expectRun(
    await run('docker', ['exec', minioContainer, 'mc', '--insecure', 'anonymous', 'set', 'none', `local/${bucket}`]),
    'MinIO private-bucket policy',
  );

  return { endpoint, certificatePath };
};

const stopMinio = async (): Promise<void> => {
  await run('docker', ['rm', '-f', minioContainer]);
  if (minioCertificateDirectory !== null) {
    rmSync(minioCertificateDirectory, { recursive: true, force: true });
    minioCertificateDirectory = null;
  }
};

interface BrowserResponse {
  status: number;
  raw: string;
}

const browserRequest = async (
  page: Page,
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<BrowserResponse> =>
  page.evaluate(
    async ({ requestPath, requestInit }) => {
      const response = await fetch(requestPath, {
        ...requestInit,
        credentials: 'same-origin',
        headers: requestInit.body === undefined ? {} : { 'content-type': 'application/json' },
      });
      return { status: response.status, raw: await response.text() };
    },
    { requestPath: path, requestInit: init },
  );

const readJson = (raw: string, label: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    throw new E2eFailure(`${label}: expected JSON.\n${raw}`);
  }
};

const okData = <S extends ZodTypeAny>(
  response: BrowserResponse,
  label: string,
  schema: S,
): output<S> => {
  assert(response.status === 200, `${label}: expected HTTP 200, got ${String(response.status)}.\n${response.raw}`);
  const envelope = looseEnvelopeSchema.parse(readJson(response.raw, label));
  assert(envelope.ok, `${label}: expected an ok envelope.\n${response.raw}`);
  const parsed = schema.safeParse(envelope.data);
  if (!parsed.success) throw new E2eFailure(`${label}: response did not match its contract.\n${parsed.error.message}`);
  return parsed.data;
};

const expectError = (
  response: BrowserResponse,
  label: string,
  status: number,
  code: string,
  privateValues: string[],
): void => {
  assert(response.status === status, `${label}: expected HTTP ${String(status)}, got ${String(response.status)}.\n${response.raw}`);
  const envelope = looseEnvelopeSchema.parse(readJson(response.raw, label));
  assert(!envelope.ok, `${label}: expected an error envelope.\n${response.raw}`);
  assert(envelope.error.code === code, `${label}: expected ${code}, got ${envelope.error.code}`);
  for (const value of privateValues) {
    assert(!response.raw.includes(value), `${label}: response exposed "${value}".\n${response.raw}`);
  }
};

const setPolish = async (context: BrowserContext): Promise<void> => {
  await context.addInitScript(() => {
    window.localStorage.setItem('together-language', 'pl');
  });
};

const signInCreator = async (page: Page, baseUrl: string): Promise<void> => {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await signInWithPassword(page, 'creator@together.dev', 'demo-password-15');
  await page.getByTestId('tenant-name').waitFor(visible);
};

const signInMember = async (page: Page, baseUrl: string): Promise<void> => {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await requestMagicLink(page, 'kursant.aktywny@together.dev');
  const sent = page.getByTestId('magic-link-sent');
  await sent.waitFor(visible);
  const link = sent.locator('a[href]').first();
  await link.waitFor(visible);
  const href = await link.getAttribute('href');
  assert(href !== null && href.length > 0, 'The member development magic link was not exposed');
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/(?:my|start)(?:[/?#]|$)/, { timeout: 15000 });
};

const configureStorage = async (page: Page, baseUrl: string, endpoint: string): Promise<void> => {
  await page.goto(`${baseUrl}/panel/integrations#storage`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('storage-wizard').waitFor(visible);
  await page.getByTestId('storage-provider-minio').click();
  await page.getByTestId('storage-provider-continue').click();
  await page.getByTestId('storage-endpoint').fill(endpoint);
  await page.getByTestId('storage-region').fill('us-east-1');
  await page.getByTestId('storage-bucket').fill(bucket);
  await page.getByTestId('storage-access-key').fill(accessKeyId);
  await page.getByTestId('storage-secret-key').fill(secretAccessKey);
  await page.getByTestId('storage-connection-continue').click();
  await page.getByTestId('storage-probe').click();
  await page.getByTestId('storage-probe-success').waitFor(visible);
  await page.getByTestId('storage-save').click();
  await page.getByTestId('storage-save-success').waitFor(visible);
  console.log('image-assets-e2e: storage wizard probe and save OK');
};

const expectImageLoaded = async (page: Page, testId: string, label: string): Promise<void> => {
  const image = page.getByTestId(testId);
  await image.waitFor(visible);
  const naturalWidth = await image.evaluate((element) =>
    element instanceof HTMLImageElement ? element.naturalWidth : 0);
  assert(naturalWidth > 0, `${label}: image naturalWidth was ${String(naturalWidth)}`);
};

const validateFilesAndUploadCourse = async (
  page: Page,
  baseUrl: string,
  minioEndpoint: string,
): Promise<string> => {
  await page.goto(`${baseUrl}/panel/courses/course-js`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('course-details-section').waitFor(visible);
  const fileInput = page.getByTestId('course-image-file-input');
  let putRequests = 0;
  const expectPutRequests = (expected: number, label: string): void => {
    assert(
      putRequests === expected,
      `${label} issued ${String(putRequests)} storage PUT request(s) instead of ${String(expected)}`,
    );
  };
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().startsWith(minioEndpoint)) putRequests += 1;
  });

  await fileInput.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await page.getByRole('alert').filter({ hasText: 'Wybierz obraz PNG, JPEG, WebP lub SVG. Favicon może być również plikiem ICO.' }).waitFor(visible);
  expectPutRequests(0, 'Invalid MIME selection');

  await fileInput.setInputFiles({
    name: 'too-large.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(IMAGE_ASSET_MAX_BYTES + 1),
  });
  await page.getByRole('alert').filter({ hasText: 'Obraz nie może być większy niż 5 MB.' }).waitFor(visible);
  expectPutRequests(0, 'Oversized selection');
  console.log('image-assets-e2e: Polish client validation blocked invalid files before PUT OK');

  const beginResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === API_PATHS.courseCoverUpload,
  );
  const putResponse = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().startsWith(minioEndpoint),
  );
  const completeResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === API_PATHS.courseCoverComplete,
  );
  const imageResponse = page.waitForResponse(
    (response) => response.request().method() === 'GET'
      && response.url().startsWith(minioEndpoint)
      && response.url().includes('/image-assets/tenant-studio/course-cover/'),
  );
  await fileInput.setInputFiles({
    name: 'one-pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(pngBase64, 'base64'),
  });
  const [begun, uploaded, completed, served] = await Promise.all([
    beginResponse,
    putResponse,
    completeResponse,
    imageResponse,
  ]);
  assert(begun.status() === 200, `Course upload begin returned HTTP ${String(begun.status())}`);
  assert(uploaded.status() === 200, `Course storage PUT returned HTTP ${String(uploaded.status())}`);
  assert(completed.status() === 200, `Course upload completion returned HTTP ${String(completed.status())}`);
  assert(served.status() === 200, `Course preview asset returned HTTP ${String(served.status())}`);
  assert(served.headers()['content-type']?.startsWith('image/png') === true, `Course preview content type was ${String(served.headers()['content-type'])}`);
  expectPutRequests(1, 'Valid course image');

  const assetPath = await page.getByTestId('course-image').inputValue();
  assert(
    /^\/api\/public\/assets\/course-cover\/[0-9a-f-]+\.png$/.test(assetPath),
    `Course image field contained an unexpected asset path: ${assetPath}`,
  );
  await expectImageLoaded(page, 'course-image-preview', 'Course upload preview');
  await page.getByTestId('course-details-section').locator('button[type="submit"]').click();
  await page.getByText('Zapisano dane kursu.').waitFor(visible);
  return assetPath;
};

const verifyPersistenceAndAnonymousServing = async (
  creatorPage: Page,
  anonymousPage: Page,
  studioBaseUrl: string,
  assetPath: string,
  minioEndpoint: string,
): Promise<void> => {
  const file = assetPath.split('/').at(-1);
  assert(file !== undefined, `Could not extract the course asset file from ${assetPath}`);
  const minioAssetPath = `/${bucket}/image-assets/tenant-studio/course-cover/${file}`;
  const reloadResponse = creatorPage.waitForResponse(
    (response) => response.request().method() === 'GET'
      && response.url().startsWith(minioEndpoint)
      && new URL(response.url()).pathname === minioAssetPath,
  );
  await creatorPage.reload({ waitUntil: 'domcontentloaded' });
  await creatorPage.getByTestId('course-details-section').waitFor(visible);
  assert(
    await creatorPage.getByTestId('course-image').inputValue() === assetPath,
    'Reloaded course editor did not retain the uploaded asset path',
  );
  await expectImageLoaded(creatorPage, 'course-image-preview', 'Reloaded course preview');
  const reloaded = await reloadResponse;
  assert(reloaded.status() === 200, `Reloaded course preview returned HTTP ${String(reloaded.status())}`);
  assert(reloaded.headers()['content-type']?.startsWith('image/png') === true, `Reloaded preview content type was ${String(reloaded.headers()['content-type'])}`);

  const anonymousResponse = anonymousPage.waitForResponse(
    (response) => response.request().method() === 'GET'
      && response.url().startsWith(minioEndpoint)
      && new URL(response.url()).pathname === minioAssetPath,
  );
  await anonymousPage.goto(`${studioBaseUrl}/`, { waitUntil: 'domcontentloaded' });
  await anonymousPage.getByTestId('anon-home-feed').waitFor(visible);
  const cover = anonymousPage.getByTestId('course-cover-course-js');
  await cover.scrollIntoViewIfNeeded();
  await expectImageLoaded(anonymousPage, 'course-cover-course-js', 'Anonymous course cover');
  assert(await cover.getAttribute('src') === assetPath, 'Anonymous course cover did not use the persisted asset path');
  const served = await anonymousResponse;
  assert(served.status() === 200, `Anonymous course cover returned HTTP ${String(served.status())}`);
  assert(served.headers()['content-type']?.startsWith('image/png') === true, `Anonymous course cover content type was ${String(served.headers()['content-type'])}`);
  console.log('image-assets-e2e: course preview, persistence, reload, and anonymous serving OK');
};

const uploadFromBrowser = async (page: Page, url: string, headers: Record<string, string>): Promise<BrowserResponse> =>
  page.evaluate(
    async ({ uploadUrl, uploadHeaders, bodyBase64 }) => {
      const binary = atob(bodyBase64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const response = await fetch(uploadUrl, { method: 'PUT', headers: uploadHeaders, body: bytes });
      return { status: response.status, raw: await response.text() };
    },
    { uploadUrl: url, uploadHeaders: headers, bodyBase64: pngBase64 },
  );

const runAssetRoundtrip = async (
  page: Page,
  label: string,
  kind: 'product-cover' | 'logo' | 'logo-dark' | 'share-image',
  beginPath: string,
  completePath: string,
): Promise<{ key: string; servePath: string }> => {
  const begin = okData(
    await browserRequest(page, beginPath, {
      method: 'POST',
      body: JSON.stringify({ kind, fileName: `${kind}.png`, contentType: 'image/png', sizeBytes: Buffer.from(pngBase64, 'base64').byteLength }),
    }),
    `${label} begin`,
    imageAssetUploadOutputSchema,
  );
  assert(begin.servePath.startsWith(`/api/public/assets/${kind}/`), `${label}: unexpected serve path ${begin.servePath}`);
  const uploaded = await uploadFromBrowser(page, begin.upload.url, begin.upload.headers);
  assert(uploaded.status === 200, `${label} PUT: expected HTTP 200, got ${String(uploaded.status)}.\n${uploaded.raw}`);
  const completed = okData(
    await browserRequest(page, completePath, { method: 'POST', body: JSON.stringify({ key: begin.key }) }),
    `${label} complete`,
    imageAssetCompleteOutputSchema,
  );
  assert(completed.url === begin.servePath, `${label}: completion returned ${completed.url} instead of ${begin.servePath}`);
  return { key: begin.key, servePath: begin.servePath };
};

const publicOfferBrandingSchema = z.object({
  tenant: z.object({
    branding: z.object({
      logoUrl: z.string().nullable(),
      logoDarkUrl: z.string().nullable(),
    }),
  }),
});

const expectServedImage = async (baseUrl: string, servePath: string, label: string): Promise<void> => {
  const response = await fetch(new URL(servePath, baseUrl));
  const contentType = response.headers.get('content-type') ?? '';
  assert(response.status === 200, `${label}: serving ${servePath} returned HTTP ${String(response.status)}`);
  assert(contentType.startsWith('image/'), `${label}: serving ${servePath} answered with ${contentType}`);
};

const verifyBrandingVariantsAndSocialPreview = async (
  page: Page,
  baseUrl: string,
  darkLogoPath: string,
  shareImagePath: string,
): Promise<void> => {
  const saved = await browserRequest(page, API_PATHS.tenantSettingsUpdate, {
    method: 'POST',
    body: JSON.stringify({ logoDarkUrl: darkLogoPath, ogImageUrl: shareImagePath }),
  });
  assert(saved.status === 200, `branding settings save returned HTTP ${String(saved.status)}.\n${saved.raw}`);

  const offer = okData(
    await browserRequest(page, API_PATHS.publicOffer),
    'public offer branding',
    publicOfferBrandingSchema,
  );
  assert(
    offer.tenant.branding.logoDarkUrl === darkLogoPath,
    `public offer exposed logoDarkUrl ${String(offer.tenant.branding.logoDarkUrl)} instead of ${darkLogoPath}`,
  );

  const preview = await fetch(baseUrl, {
    headers: { 'user-agent': 'Slackbot-LinkExpanding 1.0' },
  });
  const html = await preview.text();
  const ogImage = /<meta property="og:image" content="([^"]+)">/.exec(html)?.[1];
  assert(ogImage !== undefined, `social preview carried no og:image tag.\n${html}`);
  assert(
    ogImage === new URL(shareImagePath, baseUrl).toString(),
    `og:image was ${ogImage} instead of the absolute ${new URL(shareImagePath, baseUrl).toString()}`,
  );
  console.log('image-assets-e2e: dark logo, share image serving, and absolute og:image OK');
};

const verifyPrivateAndTenantBoundaries = async (
  creatorPage: Page,
  studioBaseUrl: string,
  acmeBaseUrl: string,
  assetPath: string,
  endpoint: string,
): Promise<void> => {
  const file = assetPath.split('/').at(-1);
  assert(file !== undefined, `Could not extract the asset file from ${assetPath}`);
  const unsignedUrl = `${endpoint}/${bucket}/image-assets/tenant-studio/course-cover/${file}`;
  const unsigned = await browserRequest(creatorPage, unsignedUrl);
  assert(
    unsigned.status === 401 || unsigned.status === 403,
    `Unsigned MinIO object returned HTTP ${String(unsigned.status)} instead of 401/403`,
  );

  const crossTenant = await fetch(new URL(assetPath, acmeBaseUrl), { redirect: 'manual' });
  const crossTenantRaw = await crossTenant.text();
  assert(crossTenant.status === 404, `Cross-tenant asset returned HTTP ${String(crossTenant.status)}.\n${crossTenantRaw}`);
  const privateValues = [endpoint, bucket, accessKeyId, secretAccessKey, 'X-Amz-Signature'];
  for (const path of [
    `/api/public/assets/not-an-asset/${file}`,
    '/api/public/assets/course-cover/not-an-image.gif',
    '/api/public/assets/logo/not-a-uuid.png',
  ]) {
    const response = await fetch(new URL(path, studioBaseUrl), { redirect: 'manual' });
    const raw = await response.text();
    assert(response.status === 404, `Malformed asset path ${path} returned HTTP ${String(response.status)}.\n${raw}`);
    for (const value of privateValues) {
      assert(!raw.includes(value), `Malformed asset path ${path} exposed "${value}".\n${raw}`);
    }
  }
  console.log('image-assets-e2e: private bucket, tenant isolation, and malformed-path normalization OK');
};

const verifyAuthorization = async (
  memberPage: Page,
  anonymousPage: Page,
  endpoint: string,
): Promise<void> => {
  const cases = [
    { label: 'course cover', path: API_PATHS.courseCoverUpload, kind: 'course-cover' },
    { label: 'product cover', path: API_PATHS.productCoverUpload, kind: 'product-cover' },
    { label: 'branding logo', path: API_PATHS.brandingAssetUpload, kind: 'logo' },
    { label: 'branding dark logo', path: API_PATHS.brandingAssetUpload, kind: 'logo-dark' },
    { label: 'share image', path: API_PATHS.brandingAssetUpload, kind: 'share-image' },
  ];
  const privateValues = [endpoint, bucket, accessKeyId, secretAccessKey, 'X-Amz-Signature', '"upload"'];
  for (const testCase of cases) {
    const init = {
      method: 'POST',
      body: JSON.stringify({
        kind: testCase.kind,
        fileName: `${testCase.kind}.png`,
        contentType: 'image/png',
        sizeBytes: Buffer.from(pngBase64, 'base64').byteLength,
      }),
    };
    expectError(
      await browserRequest(memberPage, testCase.path, init),
      `member ${testCase.label} begin`,
      403,
      'forbidden',
      privateValues,
    );
    expectError(
      await browserRequest(anonymousPage, testCase.path, init),
      `anonymous ${testCase.label} begin`,
      401,
      'unauthorized',
      privateValues,
    );
  }
  console.log('image-assets-e2e: per-capability member and anonymous denials returned no presigned URLs OK');
};

const startedAt = Date.now();
let server: ChildProcess | null = null;
let browser: Browser | null = null;
try {
  console.log('image-assets-e2e: preparing isolated database...');
  await setupDatabase(baseDatabaseUrl);
  await migrateAndSeed(e2eDatabaseUrl);
  console.log('image-assets-e2e: building the web SPA...');
  await buildWeb();

  const [serverPort, minioPort] = await Promise.all([ephemeralPort(), ephemeralPort()]);
  const connectUrl = `http://127.0.0.1:${String(serverPort)}`;
  const studioBaseUrl = `http://studio.localhost:${String(serverPort)}`;
  const acmeBaseUrl = `http://acme.localhost:${String(serverPort)}`;
  console.log(`image-assets-e2e: starting private MinIO on port ${String(minioPort)}...`);
  const minio = await startMinio(minioPort, studioBaseUrl);
  const minioEndpoint = minio.endpoint;
  console.log(`image-assets-e2e: booting server on port ${String(serverPort)}...`);
  server = await bootServer({
    port: serverPort,
    healthUrl: `${connectUrl}/api/health`,
    env: {
      DATABASE_URL: e2eDatabaseUrl,
      APP_BASE_URL: studioBaseUrl,
      APP_BASE_DOMAIN: 'localhost',
      WEB_DIST_DIR: 'dist/web',
      AUTH_DEV_EXPOSE_MAGIC_LINKS: 'true',
      EMAIL_PROVIDER: 'dev',
      SIMULATED_PAYMENTS: 'true',
      STORAGE_ALLOW_PRIVATE_ENDPOINTS: 'true',
      NODE_EXTRA_CA_CERTS: minio.certificatePath,
    },
  });

  browser = await chromium.launch(
    chromeExecutablePath
      ? { executablePath: chromeExecutablePath, headless: true }
      : { channel: 'chrome', headless: true },
  );
  const creatorContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const memberContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const anonymousContext = await browser.newContext({ ignoreHTTPSErrors: true });
  await Promise.all([setPolish(creatorContext), setPolish(memberContext), setPolish(anonymousContext)]);
  const creatorPage = await creatorContext.newPage();
  const memberPage = await memberContext.newPage();
  const anonymousPage = await anonymousContext.newPage();
  for (const page of [creatorPage, memberPage, anonymousPage]) {
    page.on('pageerror', (error) => console.log(`  [browser:pageerror] ${error.message}`));
  }
  const cdp = await creatorContext.newCDPSession(creatorPage);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  await signInCreator(creatorPage, studioBaseUrl);
  await configureStorage(creatorPage, studioBaseUrl, minioEndpoint);
  const courseAssetPath = await validateFilesAndUploadCourse(creatorPage, studioBaseUrl, minioEndpoint);
  await verifyPersistenceAndAnonymousServing(
    creatorPage,
    anonymousPage,
    studioBaseUrl,
    courseAssetPath,
    minioEndpoint,
  );
  const productCover = await runAssetRoundtrip(
    creatorPage,
    'product cover',
    'product-cover',
    API_PATHS.productCoverUpload,
    API_PATHS.productCoverComplete,
  );
  const logo = await runAssetRoundtrip(
    creatorPage,
    'branding logo',
    'logo',
    API_PATHS.brandingAssetUpload,
    API_PATHS.brandingAssetComplete,
  );
  const darkLogo = await runAssetRoundtrip(
    creatorPage,
    'branding dark logo',
    'logo-dark',
    API_PATHS.brandingAssetUpload,
    API_PATHS.brandingAssetComplete,
  );
  const shareImage = await runAssetRoundtrip(
    creatorPage,
    'share image',
    'share-image',
    API_PATHS.brandingAssetUpload,
    API_PATHS.brandingAssetComplete,
  );
  console.log(`image-assets-e2e: product, logo, dark logo and share image round trips OK (${productCover.key}, ${logo.key}, ${darkLogo.key}, ${shareImage.key})`);
  await expectServedImage(studioBaseUrl, darkLogo.servePath, 'dark logo');
  await expectServedImage(studioBaseUrl, shareImage.servePath, 'share image');
  await verifyBrandingVariantsAndSocialPreview(
    creatorPage,
    studioBaseUrl,
    darkLogo.servePath,
    shareImage.servePath,
  );
  await verifyPrivateAndTenantBoundaries(
    creatorPage,
    studioBaseUrl,
    acmeBaseUrl,
    courseAssetPath,
    minioEndpoint,
  );
  await signInMember(memberPage, studioBaseUrl);
  await verifyAuthorization(memberPage, anonymousPage, minioEndpoint);

  await Promise.all([creatorContext.close(), memberContext.close(), anonymousContext.close()]);
  console.log(`\nimage-assets-e2e: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`\nimage-assets-e2e: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server) await killServer(server);
  if (browser) await browser.close();
  await stopMinio();
  rmSync(webDistDir, { recursive: true, force: true });
  await dropDatabase(baseDatabaseUrl);
}
