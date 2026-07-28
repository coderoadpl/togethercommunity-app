import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { z } from 'zod';

import {
  API_PATHS,
  EXIT_CODE_BY_ERROR_CODE,
  TENANT_HEADER,
  healthOutputSchema,
  looseEnvelopeSchema,
  meOutputSchema,
  membersExportOutputSchema,
  myProductsOutputSchema,
  productsCreateOutputSchema,
  productsListOutputSchema,
  productsPublishOutputSchema,
  publicOfferOutputSchema,
  simulatePurchaseOutputSchema,
  tenantCreateOutputSchema,
  tenantListOutputSchema,
} from '#core/contract/index.js';

import {
  bootServer,
  delay,
  ephemeralPort,
  killServer,
  run,
  type RunResult,
  tsxBin,
} from './server-harness.js';

type Run = RunResult;

const verifyContainer = 'together-verify-pg';
const managedDatabaseUrl = 'postgres://together:together@localhost:49217/together';
const verifyDatabaseUrl = process.env['E2E_DATABASE_URL'] ?? managedDatabaseUrl;
const managesPostgres = process.env['E2E_DATABASE_URL'] === undefined;

class PocE2eFailure extends Error {}

const fail = (message: string): never => {
  throw new PocE2eFailure(message);
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new PocE2eFailure(message);
}

const startPostgres = async (): Promise<void> => {
  if (!managesPostgres) return;
  await run('docker', ['rm', '-f', verifyContainer]);
  const started = await run('docker', [
    'run',
    '--rm',
    '-d',
    '--name',
    verifyContainer,
    '-e',
    'POSTGRES_USER=together',
    '-e',
    'POSTGRES_PASSWORD=together',
    '-e',
    'POSTGRES_DB=together',
    '-p',
    '49217:5432',
    'postgres:16',
  ]);
  assert(
    started.code === 0,
    `Could not start verification Postgres.\nstdout: ${started.stdout}\nstderr: ${started.stderr}`,
  );
};

const stopPostgres = async (): Promise<void> => {
  if (!managesPostgres) return;
  await run('docker', ['rm', '-f', verifyContainer]);
};

const waitForPostgres = async (): Promise<void> => {
  const deadline = Date.now() + 30000;
  let lastError = '';
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: verifyDatabaseUrl });
    try {
      await client.connect();
      await client.query('select 1');
      await client.end();
      return;
    } catch (cause) {
      lastError = String(cause);
      await client.end().catch(() => undefined);
    }
    await delay(250);
  }
  fail(`Verification Postgres did not become ready at ${verifyDatabaseUrl}.\n${lastError}`);
};

const migrate = async (): Promise<void> => {
  const result = await run(tsxBin, ['adapters/db/migrate.ts'], { DATABASE_URL: verifyDatabaseUrl });
  assert(result.code === 0, `Migration failed:\n${result.stdout}${result.stderr}`);
};

const readJson = (raw: string, label: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return fail(`${label}: expected JSON.\n${raw}`);
  }
};

const expectOk = <S extends z.ZodTypeAny>(result: Run, label: string, schema: S): z.output<S> => {
  assert(
    result.code === 0,
    `${label}: expected exit 0, got ${result.code}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
  const parsed = looseEnvelopeSchema.parse(readJson(result.stdout, label));
  assert(parsed.ok, `${label}: expected an ok envelope, got ${JSON.stringify(parsed)}`);
  const data = schema.safeParse(parsed.data);
  if (!data.success) fail(`${label}: data did not match schema.\n${data.error.message}`);
  return data.data;
};

const expectError = (result: Run, label: string, exitCode: number, errorCode: string): void => {
  assert(
    result.code === exitCode,
    `${label}: expected exit ${exitCode}, got ${result.code}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
  const parsed = looseEnvelopeSchema.parse(readJson(result.stdout, label));
  assert(!parsed.ok, `${label}: expected an error envelope, got ok.`);
  assert(
    parsed.error.code === errorCode,
    `${label}: expected error code "${errorCode}", got "${parsed.error.code}".`,
  );
};

const authSchema = z.object({ token: z.string().min(1).nullable() });
const exportedMemberSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  createdAt: z.string(),
  productIds: z.array(z.string()),
});
const exportedMembersSchema = z.array(exportedMemberSchema);

const titles = (items: { title: string }[]): string[] => items.map((item) => item.title).sort();

const expectTitles = (actual: string[], expected: string[], label: string): void => {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label}: expected ${expected.join(', ')}, got ${actual.join(', ')}`,
  );
};

const driveCli = async (port: number, homes: string[]): Promise<number> => {
  let steps = 0;
  const url = `http://localhost:${port}`;
  const alfaHome = mkdtempSync(join(tmpdir(), 'poc-e2e-alfa-'));
  const betaHome = mkdtempSync(join(tmpdir(), 'poc-e2e-beta-'));
  const anonHome = mkdtempSync(join(tmpdir(), 'poc-e2e-anon-'));
  const buyerHome = mkdtempSync(join(tmpdir(), 'poc-e2e-buyer-'));
  homes.push(alfaHome, betaHome, anonHome, buyerHome);
  const cli = (args: string[], home: string): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', '--json', '--api-url', url, ...args], { HOME: home });

  const health = expectOk(await cli(['health'], anonHome), 'health', healthOutputSchema);
  assert(health.status === 'ok' && health.database === 'up', 'health should report ok/up');
  steps += 1;

  const alfaRegister = expectOk(
    await cli(['register', '--name', 'Alfa Creator', '--email', 'alfa@together.dev', '--password', 'Demo1234!'], alfaHome),
    'alfa register',
    authSchema,
  );
  assert(alfaRegister.token !== null, 'alfa registration should store a token');
  const alfaTenant = expectOk(
    await cli(['tenant', 'create', 'Alfa Academy', '--slug', 'alfa'], alfaHome),
    'alfa tenant create',
    tenantCreateOutputSchema,
  );
  assert(alfaTenant.tenant.slug === 'alfa' && alfaTenant.tenant.name === 'Alfa Academy', 'alfa tenant mismatch');
  const kursAlfa = expectOk(
    await cli(
      ['--tenant', 'alfa', 'product', 'create', '--title', 'Kurs Alfa', '--price-cents', '19900', '--currency', 'PLN'],
      alfaHome,
    ),
    'kurs alfa create',
    productsCreateOutputSchema,
  ).product;
  assert(kursAlfa.title === 'Kurs Alfa' && kursAlfa.priceCents === 19900 && !kursAlfa.published, 'Kurs Alfa create mismatch');
  const publishedAlfa = expectOk(
    await cli(['--tenant', 'alfa', 'product', 'publish', kursAlfa.id], alfaHome),
    'kurs alfa publish',
    productsPublishOutputSchema,
  );
  assert(publishedAlfa.product.id === kursAlfa.id && publishedAlfa.product.published, 'Kurs Alfa should be published');
  const szkic = expectOk(
    await cli(
      ['--tenant', 'alfa', 'product', 'create', '--title', 'Szkic', '--price-cents', '9900', '--currency', 'PLN'],
      alfaHome,
    ),
    'szkic create',
    productsCreateOutputSchema,
  ).product;
  assert(szkic.title === 'Szkic' && !szkic.published, 'Szkic should remain draft');
  steps += 1;

  const betaRegister = expectOk(
    await cli(['register', '--name', 'Beta Creator', '--email', 'beta@together.dev', '--password', 'Demo1234!'], betaHome),
    'beta register',
    authSchema,
  );
  assert(betaRegister.token !== null, 'beta registration should store a token');
  const betaTenant = expectOk(
    await cli(['tenant', 'create', 'Beta School', '--slug', 'beta'], betaHome),
    'beta tenant create',
    tenantCreateOutputSchema,
  );
  assert(betaTenant.tenant.slug === 'beta' && betaTenant.tenant.name === 'Beta School', 'beta tenant mismatch');
  const kursBeta = expectOk(
    await cli(
      ['--tenant', 'beta', 'product', 'create', '--title', 'Kurs Beta', '--price-cents', '4900', '--currency', 'PLN'],
      betaHome,
    ),
    'kurs beta create',
    productsCreateOutputSchema,
  ).product;
  const publishedBeta = expectOk(
    await cli(['--tenant', 'beta', 'product', 'publish', kursBeta.id], betaHome),
    'kurs beta publish',
    productsPublishOutputSchema,
  );
  assert(publishedBeta.product.id === kursBeta.id && publishedBeta.product.published, 'Kurs Beta should be published');
  steps += 1;

  expectError(
    await cli(['--tenant', 'beta', 'product', 'list'], alfaHome),
    'alfa staff cannot list beta products',
    EXIT_CODE_BY_ERROR_CODE.forbidden,
    'forbidden',
  );
  const alfaProducts = expectOk(
    await cli(['--tenant', 'alfa', 'product', 'list'], alfaHome),
    'alfa product list',
    productsListOutputSchema,
  );
  assert(alfaProducts.products.length === 2, `alfa should have exactly two products, got ${alfaProducts.products.length}`);
  expectTitles(titles(alfaProducts.products), ['Kurs Alfa', 'Szkic'], 'alfa product titles');
  steps += 1;

  const alfaOffer = expectOk(
    await cli(['--tenant', 'alfa', 'public', 'offer'], anonHome),
    'alfa public offer',
    publicOfferOutputSchema,
  );
  assert(alfaOffer.tenant.slug === 'alfa', 'alfa offer tenant mismatch');
  expectTitles(titles(alfaOffer.products), ['Kurs Alfa'], 'alfa public offer titles');
  const betaOffer = expectOk(
    await cli(['--tenant', 'beta', 'public', 'offer'], anonHome),
    'beta public offer',
    publicOfferOutputSchema,
  );
  assert(betaOffer.tenant.slug === 'beta', 'beta offer tenant mismatch');
  expectTitles(titles(betaOffer.products), ['Kurs Beta'], 'beta public offer titles');
  const firstRawOffer = await fetch(`${url}${API_PATHS.publicOffer}`, {
    headers: { [TENANT_HEADER]: 'alfa', origin: 'https://example.com' },
  });
  assert(firstRawOffer.status === 200, `raw public offer expected 200, got ${firstRawOffer.status}`);
  assert(firstRawOffer.headers.get('access-control-allow-origin') !== null, 'raw public offer should include CORS header');
  const etag = firstRawOffer.headers.get('etag');
  assert(etag !== null && etag.length > 0, 'raw public offer should include ETag');
  const firstRawEnvelope = looseEnvelopeSchema.parse(await firstRawOffer.json());
  assert(firstRawEnvelope.ok, 'raw public offer should return ok envelope');
  publicOfferOutputSchema.parse(firstRawEnvelope.data);
  const secondRawOffer = await fetch(`${url}${API_PATHS.publicOffer}`, {
    headers: { [TENANT_HEADER]: 'alfa', origin: 'https://example.com', 'if-none-match': etag },
  });
  assert(secondRawOffer.status === 304, `raw public offer repeat expected 304, got ${secondRawOffer.status}`);
  assert(secondRawOffer.headers.get('etag') === etag, '304 response should preserve ETag');
  steps += 1;

  const firstPurchase = expectOk(
    await cli(['--tenant', 'alfa', 'simulate-purchase', '--email', 'kursant@together.dev', '--product', kursAlfa.id], buyerHome),
    'simulate purchase',
    simulatePurchaseOutputSchema,
  );
  assert(firstPurchase.productId === kursAlfa.id && !firstPurchase.alreadyOwned, 'first purchase should grant Kurs Alfa');
  const repeatPurchase = expectOk(
    await cli(['--tenant', 'alfa', 'simulate-purchase', '--email', 'kursant@together.dev', '--product', kursAlfa.id], buyerHome),
    'simulate purchase repeat',
    simulatePurchaseOutputSchema,
  );
  assert(repeatPurchase.memberId === firstPurchase.memberId, 'repeat purchase should resolve the same member');
  assert(repeatPurchase.productId === kursAlfa.id && repeatPurchase.alreadyOwned, 'repeat purchase should be idempotent');
  steps += 1;

  expectOk(
    await cli(['--tenant', 'alfa', 'login-magic', '--email', 'kursant@together.dev'], buyerHome),
    'member login magic',
    authSchema,
  );
  const whoami = expectOk(await cli(['--tenant', 'alfa', 'whoami'], buyerHome), 'member whoami', meOutputSchema);
  assert(whoami.email === 'kursant@together.dev', 'whoami email mismatch');
  assert(whoami.tenant?.slug === 'alfa', 'whoami should resolve alfa tenant');
  assert(whoami.tenant.memberId !== null, 'whoami should include memberId');
  assert(whoami.tenant.staffRole === null, 'member should not have a staff role');
  steps += 1;

  const memberTenants = expectOk(await cli(['tenant', 'list'], buyerHome), 'member tenant list', tenantListOutputSchema);
  assert(memberTenants.tenants.length === 0, 'member tenant list should not enumerate tenants');
  steps += 1;

  expectError(
    await cli(['--tenant', 'alfa', 'product', 'list'], buyerHome),
    'member product list staff surface',
    EXIT_CODE_BY_ERROR_CODE.forbidden,
    'forbidden',
  );
  const myProducts = expectOk(
    await cli(['--tenant', 'alfa', 'my', 'products'], buyerHome),
    'member my products',
    myProductsOutputSchema,
  );
  assert(myProducts.products.length === 1, `member should have one product, got ${myProducts.products.length}`);
  assert(myProducts.products[0]?.id === kursAlfa.id && myProducts.products[0].title === 'Kurs Alfa', 'member grant mismatch');
  expectError(
    await cli(['--tenant', 'beta', 'my', 'products'], buyerHome),
    'member my products beta',
    EXIT_CODE_BY_ERROR_CODE.forbidden,
    'forbidden',
  );
  steps += 1;

  const alfaCsvExport = expectOk(
    await cli(['--tenant', 'alfa', 'member', 'export', '--format', 'csv'], alfaHome),
    'alfa member export csv',
    membersExportOutputSchema,
  );
  assert(alfaCsvExport.content.includes('kursant@together.dev'), 'alfa csv export should include kursant');
  const alfaJsonExport = expectOk(
    await cli(['--tenant', 'alfa', 'member', 'export', '--format', 'json'], alfaHome),
    'alfa member export json',
    membersExportOutputSchema,
  );
  const alfaExportedMembers = exportedMembersSchema.parse(readJson(alfaJsonExport.content, 'alfa json export content'));
  assert(alfaExportedMembers.length === 1, `alfa json export should have one member, got ${alfaExportedMembers.length}`);
  assert(alfaExportedMembers[0]?.email === 'kursant@together.dev', 'alfa json export member email mismatch');
  assert(
    JSON.stringify(alfaExportedMembers[0]?.productIds) === JSON.stringify([kursAlfa.id]),
    'alfa json export should contain exactly one Kurs Alfa grant',
  );
  const betaCsvExport = expectOk(
    await cli(['--tenant', 'beta', 'member', 'export', '--format', 'csv'], betaHome),
    'beta member export csv',
    membersExportOutputSchema,
  );
  assert(!betaCsvExport.content.includes('kursant@together.dev'), 'beta export should not include alfa member');
  expectError(
    await cli(['--tenant', 'alfa', 'member', 'export', '--format', 'csv'], buyerHome),
    'member export forbidden',
    EXIT_CODE_BY_ERROR_CODE.forbidden,
    'forbidden',
  );
  steps += 1;

  return steps;
};

const startedAt = Date.now();
const homes: string[] = [];
let server: ChildProcess | null = null;
let postgresStarted = false;

try {
  console.log('poc-e2e: starting fresh verification Postgres...');
  await startPostgres();
  postgresStarted = true;
  await waitForPostgres();
  console.log('poc-e2e: running migrations...');
  await migrate();
  const port = await ephemeralPort();
  const webDistDir = mkdtempSync(join(tmpdir(), 'poc-e2e-web-'));
  homes.push(webDistDir);
  console.log(`poc-e2e: booting server on port ${port}...`);
  server = await bootServer({
    port,
    healthUrl: `http://localhost:${String(port)}${API_PATHS.health}`,
    env: {
      DATABASE_URL: verifyDatabaseUrl,
      APP_BASE_URL: `http://localhost:${String(port)}`,
      APP_BASE_DOMAIN: 'localhost',
      WEB_DIST_DIR: webDistDir,
      SIMULATED_PAYMENTS: 'true',
      AUTH_DEV_EXPOSE_MAGIC_LINKS: 'true',
    },
  });
  console.log('poc-e2e: driving full CLI scenario...');
  const steps = await driveCli(port, homes);
  console.log(`\npoc-e2e: PASS (${steps} steps, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof PocE2eFailure ? error.message : String(error);
  console.error(`\npoc-e2e: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server) await killServer(server);
  for (const dir of homes) rmSync(dir, { recursive: true, force: true });
  if (postgresStarted) await stopPostgres();
}
