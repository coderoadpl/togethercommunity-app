import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { z } from 'zod';

import {
  API_PATHS,
  EXIT_CODE_BY_ERROR_CODE,
  TENANT_HEADER,
  checkoutSessionOutputSchema,
  courseOutputSchema,
  healthOutputSchema,
  looseEnvelopeSchema,
  meOutputSchema,
  memberBanOutputSchema,
  memberDataExportOutputSchema,
  memberErasureRequestMutationOutputSchema,
  memberErasureRequestsOutputSchema,
  memberRemoveOutputSchema,
  membersExportOutputSchema,
  myProductsOutputSchema,
  orderFulfilmentContracts,
  shipxContracts,
  ordersExportOutputSchema,
  ordersListOutputSchema,
  ordersReconciliationOutputSchema,
  productPriceCreateOutputSchema,
  productsCreateOutputSchema,
  productsListOutputSchema,
  productsPublishOutputSchema,
  productStockOutputSchema,
  productStockWriteOutputSchema,
  publicOfferOutputSchema,
  salesLinkContracts,
  simulatePurchaseOutputSchema,
  spaceOutputSchema,
  supportMessageOutputSchema,
  tenantCreateOutputSchema,
  tenantListOutputSchema,
  tenantSettingsOutputSchema,
} from '#core/contract/index.js';
import { memberDataExportSchema } from '#core/domain/index.js';

import {
  bootServer,
  delay,
  ephemeralPort,
  killServer,
  run,
  type RunResult,
  tsxBin,
} from './server-harness.js';
import { passwordFixture } from './password-fixture.js';
import { pullImages } from './docker-pull.js';

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
  await pullImages(['public.ecr.aws/docker/library/postgres:16']);
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
    'public.ecr.aws/docker/library/postgres:16',
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
const devEmailResultSchema = z.object({
  email: z.object({ to: z.string().email(), subject: z.string(), text: z.string(), html: z.string() }).nullable(),
});
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
  const cli = (args: string[], home: string, env: NodeJS.ProcessEnv = {}): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', '--json', '--api-url', url, ...args], { ...env, HOME: home });

  const health = expectOk(await cli(['health'], anonHome), 'health', healthOutputSchema);
  assert(health.status === 'ok' && health.database === 'up', 'health should report ok/up');
  steps += 1;

  const alfaRegister = expectOk(
    await cli(
      [
        'register',
        '--name',
        'Alfa Creator',
        '--email',
        'alfa@together.dev',
        '--password',
        passwordFixture('Demo1234!'),
      ],
      alfaHome,
    ),
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
  const alfaSpace = expectOk(
    await cli(
      ['--tenant', 'alfa', 'space', 'create', '--slug', 'community', '--name', 'Community', '--visibility', 'members'],
      alfaHome,
    ),
    'alfa space create',
    spaceOutputSchema,
  ).space;
  const alfaCourse = expectOk(
    await cli(['--tenant', 'alfa', 'course', 'create', '--name', 'Alpha Course'], alfaHome),
    'alpha course create',
    courseOutputSchema,
  ).course;
  const alphaCourse = expectOk(
    await cli(
      [
        '--tenant', 'alfa', 'product', 'create', '--title', 'Alpha Course', '--price-cents', '19900',
        '--currency', 'PLN', '--access-items', JSON.stringify([{ level: 'course', courseId: alfaCourse.id }]),
      ],
      alfaHome,
    ),
    'alpha product create',
    productsCreateOutputSchema,
  ).product;
  assert(alphaCourse.title === 'Alpha Course' && alphaCourse.priceCents === 19900 && !alphaCourse.published, 'Alpha Course create mismatch');
  expectOk(
    await cli(
      ['--tenant', 'alfa', 'price', 'add', '--product', alphaCourse.id, '--kind', 'one_time', '--price-cents', '19900'],
      alfaHome,
    ),
    'alpha price add',
    productPriceCreateOutputSchema,
  );
  const publishedAlfa = expectOk(
    await cli(['--tenant', 'alfa', 'product', 'publish', alphaCourse.id], alfaHome),
    'alpha publish',
    productsPublishOutputSchema,
  );
  assert(publishedAlfa.product.id === alphaCourse.id && publishedAlfa.product.published, 'Alpha Course should be published');
  const draft = expectOk(
    await cli(
      ['--tenant', 'alfa', 'product', 'create', '--title', 'Draft', '--price-cents', '9900', '--currency', 'PLN'],
      alfaHome,
    ),
    'draft create',
    productsCreateOutputSchema,
  ).product;
  assert(draft.title === 'Draft' && !draft.published, 'Draft should remain unpublished');
  steps += 1;

  const betaRegister = expectOk(
    await cli(
      [
        'register',
        '--name',
        'Beta Creator',
        '--email',
        'beta@together.dev',
        '--password',
        passwordFixture('Demo1234!'),
      ],
      betaHome,
    ),
    'beta register',
    authSchema,
  );
  assert(betaRegister.token !== null, 'beta registration should store a token');
  expectError(
    await cli(['tenant', 'create', 'Beta School', '--slug', 'beta'], betaHome),
    'beta tenant create before verification',
    EXIT_CODE_BY_ERROR_CODE.forbidden,
    'forbidden',
  );
  let betaVerificationUrl = '';
  const betaVerificationDeadline = Date.now() + 10000;
  while (Date.now() < betaVerificationDeadline && betaVerificationUrl === '') {
    const delivered = expectOk(
      await cli(['dev', 'email', '--to', 'beta@together.dev'], betaHome),
      'beta verification email inspect',
      devEmailResultSchema,
    ).email;
    betaVerificationUrl = delivered?.text.match(/https?:\/\/\S+/)?.[0] ?? '';
    if (betaVerificationUrl === '') await delay(100);
  }
  assert(betaVerificationUrl !== '', 'beta should receive a verification email with a callback URL');
  const betaVerification = await fetch(betaVerificationUrl, { redirect: 'manual' });
  assert(
    betaVerification.status === 302,
    `beta verification callback should redirect, got ${betaVerification.status}`,
  );
  const betaTenant = expectOk(
    await cli(['tenant', 'create', 'Beta School', '--slug', 'beta'], betaHome),
    'beta tenant create',
    tenantCreateOutputSchema,
  );
  assert(betaTenant.tenant.slug === 'beta' && betaTenant.tenant.name === 'Beta School', 'beta tenant mismatch');
  const betaCourse = expectOk(
    await cli(['--tenant', 'beta', 'course', 'create', '--name', 'Beta Course'], betaHome),
    'beta course create',
    courseOutputSchema,
  ).course;
  const betaProduct = expectOk(
    await cli(
      [
        '--tenant', 'beta', 'product', 'create', '--title', 'Beta Course', '--price-cents', '4900',
        '--currency', 'PLN', '--access-items', JSON.stringify([{ level: 'course', courseId: betaCourse.id }]),
      ],
      betaHome,
    ),
    'beta product create',
    productsCreateOutputSchema,
  ).product;
  expectOk(
    await cli(
      ['--tenant', 'beta', 'price', 'add', '--product', betaProduct.id, '--kind', 'one_time', '--price-cents', '4900'],
      betaHome,
    ),
    'beta price add',
    productPriceCreateOutputSchema,
  );
  const publishedBeta = expectOk(
    await cli(['--tenant', 'beta', 'product', 'publish', betaProduct.id], betaHome),
    'beta publish',
    productsPublishOutputSchema,
  );
  assert(publishedBeta.product.id === betaProduct.id && publishedBeta.product.published, 'Beta Course should be published');
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
  expectTitles(titles(alfaProducts.products), ['Alpha Course', 'Draft'], 'alfa product titles');
  steps += 1;

  const alfaOffer = expectOk(
    await cli(['--tenant', 'alfa', 'public', 'offer'], anonHome),
    'alfa public offer',
    publicOfferOutputSchema,
  );
  assert(alfaOffer.tenant.slug === 'alfa', 'alfa offer tenant mismatch');
  expectTitles(titles(alfaOffer.products), ['Alpha Course'], 'alfa public offer titles');
  const betaOffer = expectOk(
    await cli(['--tenant', 'beta', 'public', 'offer'], anonHome),
    'beta public offer',
    publicOfferOutputSchema,
  );
  assert(betaOffer.tenant.slug === 'beta', 'beta offer tenant mismatch');
  expectTitles(titles(betaOffer.products), ['Beta Course'], 'beta public offer titles');
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
    await cli(['--tenant', 'alfa', 'simulate-purchase', '--email', 'learner@together.dev', '--product', alphaCourse.id], buyerHome),
    'simulate purchase',
    simulatePurchaseOutputSchema,
  );
  assert(firstPurchase.productId === alphaCourse.id && !firstPurchase.alreadyOwned, 'first purchase should grant Alpha Course');
  const repeatPurchase = expectOk(
    await cli(['--tenant', 'alfa', 'simulate-purchase', '--email', 'learner@together.dev', '--product', alphaCourse.id], buyerHome),
    'simulate purchase repeat',
    simulatePurchaseOutputSchema,
  );
  assert(repeatPurchase.memberId === firstPurchase.memberId, 'repeat purchase should resolve the same member');
  assert(repeatPurchase.productId === alphaCourse.id && repeatPurchase.alreadyOwned, 'repeat purchase should be idempotent');
  steps += 1;

  expectOk(
    await cli(['--tenant', 'alfa', 'login-magic', '--email', 'learner@together.dev'], buyerHome),
    'member login magic',
    authSchema,
  );
  const whoami = expectOk(await cli(['--tenant', 'alfa', 'whoami'], buyerHome), 'member whoami', meOutputSchema);
  assert(whoami.email === 'learner@together.dev', 'whoami email mismatch');
  assert(whoami.tenant?.slug === 'alfa', 'whoami should resolve alfa tenant');
  assert(whoami.tenant.memberId !== null, 'whoami should include memberId');
  assert(whoami.tenant.staffRole === null, 'member should not have a staff role');
  steps += 1;

  expectOk(
    await cli(
      ['--tenant', 'alfa', 'member', 'ban', '--member', whoami.tenant.memberId, '--reason', 'PoC taxonomy probe'],
      alfaHome,
    ),
    'staff bans member',
    memberBanOutputSchema,
  );
  expectError(
    await cli(
      ['--tenant', 'alfa', 'space', 'post', '--space', alfaSpace.id, '--body', 'This post must be refused while banned.'],
      buyerHome,
    ),
    'banned member post',
    EXIT_CODE_BY_ERROR_CODE.banned,
    'banned',
  );
  expectOk(
    await cli(['--tenant', 'alfa', 'member', 'unban', '--member', whoami.tenant.memberId], alfaHome),
    'staff lifts member ban',
    memberBanOutputSchema,
  );
  steps += 1;

  const db = new pg.Client({ connectionString: verifyDatabaseUrl });
  await db.connect();
  try {
    await db.query(
      'update tenants set support_email = $1 where id = $2',
      ['support@alfa.test', alfaTenant.tenant.id],
    );
  } finally {
    await db.end();
  }
  expectOk(
    await cli(
      ['--tenant', 'alfa', 'support', 'send', '--subject', 'Help', '--body', 'Support request body'],
      buyerHome,
    ),
    'member support request',
    supportMessageOutputSchema,
  );
  expectError(
    await cli(['--tenant', 'alfa', 'support', 'send', '--subject', 'Help', '--body', 'Message'], anonHome),
    'unscoped support request',
    EXIT_CODE_BY_ERROR_CODE.unauthorized,
    'unauthorized',
  );
  const reconciliation = expectOk(
    await cli(['--tenant', 'alfa', 'orders', 'reconciliation'], alfaHome),
    'staff order reconciliation',
    ordersReconciliationOutputSchema,
  );
  assert(reconciliation.rows.length === 0, 'healthy purchases should not appear in reconciliation');
  expectError(
    await cli(['--tenant', 'alfa', 'orders', 'reconciliation'], buyerHome),
    'member order reconciliation',
    EXIT_CODE_BY_ERROR_CODE.forbidden,
    'forbidden',
  );
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
  assert(myProducts.products[0]?.id === alphaCourse.id && myProducts.products[0].title === 'Alpha Course', 'member grant mismatch');
  const myDataExport = expectOk(
    await cli(['--tenant', 'alfa', 'my', 'data-export'], buyerHome),
    'member data export',
    memberDataExportOutputSchema,
  );
  const exportedMemberData = memberDataExportSchema.parse(JSON.parse(myDataExport.content));
  assert(
    exportedMemberData.profile.email === 'learner@together.dev',
    'member data export email mismatch',
  );
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
  assert(alfaCsvExport.content.includes('learner@together.dev'), 'alfa csv export should include learner');
  assert(alfaCsvExport.content.includes('alfa@together.dev'), 'alfa csv export should include its owner');
  const alfaJsonExport = expectOk(
    await cli(['--tenant', 'alfa', 'member', 'export', '--format', 'json'], alfaHome),
    'alfa member export json',
    membersExportOutputSchema,
  );
  const alfaExportedMembers = exportedMembersSchema.parse(readJson(alfaJsonExport.content, 'alfa json export content'));
  assert(alfaExportedMembers.length === 2, `alfa json export should have the owner and learner, got ${alfaExportedMembers.length}`);
  const alfaExportedOwner = alfaExportedMembers.find((member) => member.email === 'alfa@together.dev');
  const alfaExportedLearner = alfaExportedMembers.find((member) => member.email === 'learner@together.dev');
  assert(alfaExportedOwner?.productIds.length === 0, 'alfa owner membership should not create product grants');
  assert(
    JSON.stringify(alfaExportedLearner?.productIds) === JSON.stringify([alphaCourse.id]),
    'alfa json export should contain exactly one Alpha Course grant',
  );
  const betaCsvExport = expectOk(
    await cli(['--tenant', 'beta', 'member', 'export', '--format', 'csv'], betaHome),
    'beta member export csv',
    membersExportOutputSchema,
  );
  assert(!betaCsvExport.content.includes('learner@together.dev'), 'beta export should not include alfa member');
  expectError(
    await cli(['--tenant', 'alfa', 'member', 'export', '--format', 'csv'], buyerHome),
    'member export forbidden',
    EXIT_CODE_BY_ERROR_CODE.forbidden,
    'forbidden',
  );
  const erasureRequest = expectOk(
    await cli(
      [
        '--tenant',
        'alfa',
        'my',
        'erasure-request',
        'create',
        '--confirm-email',
        exportedMemberData.profile.email,
      ],
      buyerHome,
    ),
    'member erasure request',
    memberErasureRequestMutationOutputSchema,
  );
  const openErasureRequests = expectOk(
    await cli(
      ['--tenant', 'alfa', 'member', 'erasure-requests', '--status', 'open'],
      alfaHome,
    ),
    'staff open erasure requests',
    memberErasureRequestsOutputSchema,
  );
  assert(
    openErasureRequests.requests.some(
      (request) => request.id === erasureRequest.request.id,
    ),
    'staff should see the member erasure request',
  );
  const removal = expectOk(
    await cli(
      [
        '--tenant',
        'alfa',
        'member',
        'remove',
        exportedMemberData.profile.memberId,
      ],
      alfaHome,
    ),
    'staff executes member erasure',
    memberRemoveOutputSchema,
  );
  assert(
    removal.erasureRequestId === erasureRequest.request.id,
    'member removal should report the completed request',
  );
  const completedErasureRequests = expectOk(
    await cli(
      ['--tenant', 'alfa', 'member', 'erasure-requests', '--status', 'completed'],
      alfaHome,
    ),
    'staff completed erasure requests',
    memberErasureRequestsOutputSchema,
  );
  assert(
    completedErasureRequests.requests.some(
      (request) =>
        request.id === erasureRequest.request.id &&
        request.status === 'completed',
    ),
    'member erasure request should be completed',
  );
  steps += 1;

  const shippingRates = [{ id: 'locker', label: 'Parcel locker', amountCents: 1499, carrier: 'inpost', pickupPoint: 'inpost_locker', active: true }];
  const shippingSettings = expectOk(
    await cli(['--tenant', 'alfa', 'tenant', 'settings-set', '--shipping-rates', JSON.stringify(shippingRates)], alfaHome),
    'shipping rates set',
    tenantSettingsOutputSchema,
  );
  assert(shippingSettings.settings.shippingRates?.[0]?.vatRatePercent === 23, 'shipping rate should default to 23 percent VAT');
  const shippedProduct = expectOk(
    await cli(
      [
        '--tenant', 'alfa', 'product', 'create', '--title', 'Printed accessory', '--type', 'physical',
        '--delivery-method', 'shipping', '--price-cents', '4900', '--currency', 'PLN', '--vat-rate', '23',
      ],
      alfaHome,
    ),
    'shipped product create',
    productsCreateOutputSchema,
  ).product;
  assert(shippedProduct.deliveryMethod === 'shipping', 'shipped product should keep its delivery method');
  expectOk(
    await cli(['--tenant', 'alfa', 'price', 'add', '--product', shippedProduct.id, '--kind', 'one_time', '--price-cents', '4900'], alfaHome),
    'shipped price add',
    productPriceCreateOutputSchema,
  );
  expectOk(await cli(['--tenant', 'alfa', 'product', 'publish', shippedProduct.id], alfaHome), 'shipped publish', productsPublishOutputSchema);
  expectError(
    await cli(['--tenant', 'alfa', 'simulate-purchase', '--email', 'shipped@together.dev', '--product', shippedProduct.id], buyerHome),
    'shipped purchase without delivery',
    EXIT_CODE_BY_ERROR_CODE.shipping_required,
    'shipping_required',
  );
  expectError(
    await cli([
      '--tenant', 'alfa', 'simulate-purchase', '--email', 'shipped@together.dev', '--product', shippedProduct.id,
      '--shipping-phone', '+48 500 000 000', '--shipping-rate', 'locker', '--pickup-point', 'not-a-locker',
    ], buyerHome),
    'shipped purchase with a malformed locker code',
    EXIT_CODE_BY_ERROR_CODE.validation,
    'validation',
  );
  const shippedPurchase = expectOk(
    await cli([
      '--tenant', 'alfa', 'simulate-purchase', '--email', 'shipped@together.dev', '--product', shippedProduct.id,
      '--shipping-phone', '+48 500 000 000', '--shipping-rate', 'locker', '--pickup-point', 'waw01m',
    ], buyerHome),
    'shipped purchase',
    simulatePurchaseOutputSchema,
  );
  const toPack = expectOk(
    await cli(['--tenant', 'alfa', 'orders', 'list', '--fulfilment', 'to_pack'], alfaHome),
    'orders to pack',
    ordersListOutputSchema,
  );
  const shippedOrder = toPack.orders.find((order) => order.id === shippedPurchase.orderId);
  assert(
    toPack.orders.length === 1 && shippedOrder?.fulfilmentStatus === 'to_pack' && shippedOrder.amountCents === 6399
      && shippedOrder.shipping?.pickupPoint?.code === 'WAW01M' && shippedOrder.shipping.address.country === 'PL'
      && shippedOrder.lines?.at(-1)?.productType === 'shipping',
    `shipped order should be the only order to pack: ${JSON.stringify(toPack.orders)}`,
  );
  const poster = expectOk(
    await cli(
      ['--tenant', 'alfa', 'product', 'create', '--type', 'physical', '--title', 'Printed Poster', '--price-cents', '4900', '--currency', 'PLN', '--visibility', 'unlisted'],
      alfaHome,
    ),
    'physical product create',
    productsCreateOutputSchema,
  ).product;
  expectOk(
    await cli(['--tenant', 'alfa', 'price', 'add', '--product', poster.id, '--kind', 'one_time', '--price-cents', '4900'], alfaHome),
    'physical price add',
    productPriceCreateOutputSchema,
  );
  expectOk(await cli(['--tenant', 'alfa', 'product', 'publish', poster.id], alfaHome), 'physical publish', productsPublishOutputSchema);
  const tracked = expectOk(
    await cli(['--tenant', 'alfa', 'product', 'stock', 'enable', poster.id, '--on-hand', '1'], alfaHome),
    'stock enable',
    productStockWriteOutputSchema,
  );
  assert(tracked.stock.onHand === 1 && tracked.stock.available === 1, 'stock tracking should start with one piece');
  const buyPoster = (email: string) =>
    cli(['--tenant', 'alfa', 'simulate-purchase', '--email', email, '--product', poster.id], buyerHome);
  expectOk(await buyPoster('poster-first@together.dev'), 'last piece purchase', simulatePurchaseOutputSchema);
  expectError(await buyPoster('poster-second@together.dev'), 'sold-out purchase', EXIT_CODE_BY_ERROR_CODE.sold_out, 'sold_out');
  expectOk(
    await cli(['--tenant', 'alfa', 'product', 'stock', 'adjust', poster.id, '--delta', '1', '--reason', 'restock'], alfaHome),
    'stock adjust',
    productStockWriteOutputSchema,
  );
  expectOk(await buyPoster('poster-second@together.dev'), 'restocked purchase', simulatePurchaseOutputSchema);
  const finalStock = expectOk(
    await cli(['--tenant', 'alfa', 'product', 'stock', 'show', poster.id], alfaHome),
    'stock show',
    productStockOutputSchema,
  ).stock;
  assert(finalStock !== null && finalStock.onHand === 0 && finalStock.reserved === 0 && finalStock.soldOut, 'both pieces should be sold with no reservation left');
  const shippedOrderId = shippedPurchase.orderId;
  assert(shippedOrderId !== null, 'shipped purchase should return its order id');
  const packingList = expectOk(
    await cli(['--tenant', 'alfa', 'orders', 'packing-list', '--format', 'csv'], alfaHome),
    'packing list',
    ordersExportOutputSchema,
  );
  const packingRows = packingList.content.split('\n');
  assert(
    packingRows.length === 2 && packingRows[1]?.startsWith(`"${shippedOrderId}",`) === true
      && packingRows[1].includes('"WAW01M"') && packingRows[1].includes('"Printed accessory × 1"'),
    `packing list should hold the order to pack: ${packingList.content}`,
  );
  const shipped = expectOk(
    await cli(['--tenant', 'alfa', 'orders', 'ship', shippedOrderId, '--carrier', 'inpost', '--tracking', '520000011395200025754311'], alfaHome),
    'order ship',
    orderFulfilmentContracts.shipOrder.output,
  ).order;
  assert(
    shipped.fulfilmentStatus === 'shipped' && shipped.shipment?.carrier === 'inpost'
      && shipped.shipment.trackingNumber === '520000011395200025754311',
    `order should be shipped with the tracking number: ${JSON.stringify(shipped)}`,
  );
  expectError(
    await cli(['--tenant', 'alfa', 'orders', 'ship', shippedOrderId, '--carrier', 'inpost', '--tracking', 'SECOND01'], alfaHome),
    'second shipment',
    EXIT_CODE_BY_ERROR_CODE.fulfilment_conflict,
    'fulfilment_conflict',
  );
  const shippedList = expectOk(
    await cli(['--tenant', 'alfa', 'orders', 'list', '--fulfilment', 'shipped'], alfaHome),
    'shipped orders',
    ordersListOutputSchema,
  );
  assert(
    shippedList.orders.map((order) => order.id).join(',') === shippedOrderId,
    `the shipped order should be listed as shipped: ${JSON.stringify(shippedList.orders)}`,
  );
  const shipxPurchase = expectOk(
    await cli([
      '--tenant', 'alfa', 'simulate-purchase', '--email', 'shipx@together.dev', '--product', shippedProduct.id,
      '--shipping-phone', '+48 500 000 000', '--shipping-rate', 'locker', '--pickup-point', 'WAW02M',
    ], buyerHome),
    'InPost purchase',
    simulatePurchaseOutputSchema,
  );
  const shipxOrderId = shipxPurchase.orderId;
  assert(shipxOrderId !== null, 'InPost purchase should return its order id');
  const unconfigured = expectOk(await cli(['--tenant', 'alfa', 'order', 'shipx', 'show', shipxOrderId], alfaHome), 'InPost readiness before setup', shipxContracts.shipxShipment.output);
  assert(
    !unconfigured.available && unconfigured.reason === 'credentials_missing' && unconfigured.environment === 'production' && unconfigured.service === 'inpost_locker_standard',
    `InPost should wait for the production credentials of the simulated live order: ${JSON.stringify(unconfigured)}`,
  );
  expectError(
    await cli(['--tenant', 'alfa', 'order', 'shipx', 'create', shipxOrderId], alfaHome),
    'InPost shipment without credentials',
    EXIT_CODE_BY_ERROR_CODE.integration_not_configured,
    'integration_not_configured',
  );
  const shipxSettings = expectOk(
    await cli([
      '--tenant', 'alfa', 'tenant', 'shipx-set', '--slot', 'production', '--organization-id', '1234', '--token-env', 'SMOKE_SHIPX_TOKEN',
      '--sender', JSON.stringify({ name: 'Smoke Sender', email: 'sender@together.dev', phone: '500600700', street: 'Example Street', buildingNumber: '7', city: 'Warsaw', postCode: '00-001' }),
    ], alfaHome, { SMOKE_SHIPX_TOKEN: 'smoke-shipx-token' }),
    'InPost settings',
    shipxContracts.shipxConfigure.output,
  );
  assert(
    shipxSettings.production.configured && !shipxSettings.sandbox.configured && !JSON.stringify(shipxSettings).includes('smoke-shipx-token'),
    `InPost production settings should be configured and masked, and the sandbox left alone: ${JSON.stringify(shipxSettings)}`,
  );
  const shipxCreated = expectOk(await cli(['--tenant', 'alfa', 'order', 'shipx', 'create', shipxOrderId], alfaHome), 'InPost shipment', shipxContracts.shipxCreate.output);
  assert(
    shipxCreated.order.fulfilmentStatus === 'to_pack' && shipxCreated.order.label?.carrier === 'inpost'
      && shipxCreated.shipment.trackingNumber !== null && shipxCreated.order.label.trackingNumber === shipxCreated.shipment.trackingNumber,
    `InPost label should leave the order to pack: ${JSON.stringify(shipxCreated)}`,
  );
  const marked = expectOk(await cli(['--tenant', 'alfa', 'order', 'ship', shipxOrderId, '--carrier', 'inpost', '--tracking', shipxCreated.shipment.trackingNumber ?? ''], alfaHome), 'mark labelled order shipped', orderFulfilmentContracts.shipOrder.output);
  assert(marked.order.fulfilmentStatus === 'shipped', 'Mark as shipped should dispatch the labelled order');
  const shipxRefreshed = expectOk(await cli(['--tenant', 'alfa', 'order', 'shipx', 'refresh', shipxOrderId], alfaHome), 'InPost refresh', shipxContracts.shipxRefresh.output);
  assert(
    shipxRefreshed.reason === 'not_to_pack' && shipxRefreshed.shipment?.trackingNumber === shipxCreated.shipment.trackingNumber,
    `InPost refresh should return the bought shipment of the shipped order: ${JSON.stringify(shipxRefreshed)}`,
  );
  const labelPath = join(alfaHome, 'inpost-label.pdf');
  expectOk(
    await cli(['--tenant', 'alfa', 'order', 'shipx', 'label', shipxOrderId, '--out', labelPath], alfaHome),
    'InPost label',
    z.object({ filename: z.string().startsWith('inpost-'), contentType: z.literal('application/pdf'), bytes: z.number().int().positive() }),
  );
  assert(readFileSync(labelPath).subarray(0, 5).toString('latin1') === '%PDF-', 'InPost label should be a PDF');
  expectError(
    await cli(['--tenant', 'alfa', 'order', 'shipx', 'create', shipxOrderId], alfaHome),
    'second InPost shipment',
    EXIT_CODE_BY_ERROR_CODE.fulfilment_conflict,
    'fulfilment_conflict',
  );
  steps += 1;

  const oneStepPurchase = expectOk(await cli([
    '--tenant', 'alfa', 'simulate-purchase', '--email', 'shipx-dispatch@example.org', '--product', shippedProduct.id,
    '--shipping-rate', 'locker', '--pickup-point', 'WAW02M',
  ], buyerHome), 'one-step InPost purchase', simulatePurchaseOutputSchema);
  assert(oneStepPurchase.orderId !== null, 'The one-step purchase should return its order id');
  const oneStepShipment = expectOk(await cli([
    '--tenant', 'alfa', 'order', 'shipx', 'create', oneStepPurchase.orderId, '--mark-shipped',
  ], alfaHome), 'one-step InPost dispatch', shipxContracts.shipxCreate.output);
  assert(oneStepShipment.order.fulfilmentStatus === 'shipped'
    && oneStepShipment.order.shipment?.trackingNumber === oneStepShipment.shipment.trackingNumber,
  'The explicit one-step flow should dispatch with the stored tracking number');

  const engraving = {
    label: 'Add an engraving',
    description: 'Engraved by hand before shipping.',
    inputLabel: 'Engraving text',
    maxLength: 60,
    condition: 'I understand a personalised item is made to my order.',
  };
  const engravingPath = join(alfaHome, 'engraving.json');
  writeFileSync(engravingPath, JSON.stringify(engraving));
  const book = expectOk(
    await cli([
      '--tenant', 'alfa', 'product', 'create', '--title', 'Printed book', '--type', 'physical', '--delivery-method', 'shipping',
      '--price-cents', '5900', '--currency', 'PLN', '--vat-rate', '5', '--personalization-file', engravingPath,
    ], alfaHome),
    'personalised product create',
    productsCreateOutputSchema,
  ).product;
  assert(JSON.stringify(book.personalization) === JSON.stringify(engraving), `product should store the personalisation: ${JSON.stringify(book)}`);
  expectOk(
    await cli(['--tenant', 'alfa', 'price', 'add', '--product', book.id, '--kind', 'one_time', '--price-cents', '5900'], alfaHome),
    'personalised price add',
    productPriceCreateOutputSchema,
  );
  expectOk(await cli(['--tenant', 'alfa', 'product', 'publish', book.id], alfaHome), 'personalised publish', productsPublishOutputSchema);
  const bookLink = expectOk(
    await cli(['--tenant', 'alfa', 'sales-link', 'create', '--input', JSON.stringify({
      slug: 'printed-book', title: 'Printed book', heading: 'Printed book', productIds: [book.id], active: true,
    })], alfaHome),
    'personalised sales link create',
    salesLinkContracts.createSalesLink.output,
  ).salesLink;
  const bookOffer = expectOk(
    await cli(['--tenant', 'alfa', 'sales-link', 'offer', bookLink.slug], anonHome),
    'personalised sales link offer',
    salesLinkContracts.getPublicSalesLink.output,
  );
  assert(
    JSON.stringify(bookOffer.lines[0]?.personalization) === JSON.stringify(engraving),
    `sales link offer should expose the personalisation: ${JSON.stringify(bookOffer.lines)}`,
  );
  expectError(
    await cli(['--tenant', 'alfa', 'sales-link', 'checkout', bookLink.slug], anonHome),
    'direct handoff of a personalised sales link',
    EXIT_CODE_BY_ERROR_CODE.validation,
    'validation',
  );
  const engravingText = 'For Ann & Bo <3';
  const buyBook = (extra: string[]) => cli([
    '--tenant', 'alfa', 'simulate-purchase', '--sales-link', bookLink.id, '--product', book.id, '--email', 'engraving@together.dev',
    '--shipping-phone', '+48 500 000 000', '--shipping-rate', 'locker', '--pickup-point', 'WAW03M', '--personalization', `${book.id}:${engravingText}`, ...extra,
  ], buyerHome);
  expectError(await buyBook([]), 'personalisation without the accepted condition', EXIT_CODE_BY_ERROR_CODE.validation, 'validation');
  const bookPurchase = expectOk(await buyBook(['--accept-condition']), 'personalised purchase', simulatePurchaseOutputSchema);
  const bookOrderId = bookPurchase.orderId;
  assert(bookOrderId !== null, 'personalised purchase should return its order id');
  writeFileSync(engravingPath, JSON.stringify({ ...engraving, label: 'Add a dedication' }));
  expectOk(
    await cli(['--tenant', 'alfa', 'product', 'update', book.id, '--personalization-file', engravingPath], alfaHome),
    'personalisation edit after the purchase',
    productsCreateOutputSchema,
  );
  const bookToPack = expectOk(
    await cli(['--tenant', 'alfa', 'orders', 'list', '--fulfilment', 'to_pack'], alfaHome),
    'personalised order to pack',
    ordersListOutputSchema,
  );
  const bookLine = bookToPack.orders.find((order) => order.id === bookOrderId)?.lines?.find((line) => line.productId === book.id);
  assert(
    bookLine?.personalization?.text === engravingText && bookLine.personalization.label === engraving.label
      && bookLine.personalization.condition === engraving.condition && bookLine.personalization.conditionAcceptedAt !== null,
    `order line should carry the captured personalisation: ${JSON.stringify(bookToPack.orders)}`,
  );
  const engravingSummary = `Printed book: ${engravingText}`;
  const bookPackingList = expectOk(
    await cli(['--tenant', 'alfa', 'orders', 'packing-list', '--format', 'csv'], alfaHome),
    'personalised packing list',
    ordersExportOutputSchema,
  );
  const [packingHeader, ...bookPackingRows] = bookPackingList.content.split('\n');
  assert(
    packingHeader?.endsWith(',quantity,personalization') === true
      && bookPackingRows.some((row) => row.startsWith(`"${bookOrderId}",`) && row.endsWith(`,"1","${engravingSummary}"`)),
    `packing list should end with the personalisation column: ${bookPackingList.content}`,
  );
  const csvExport = expectOk(
    await cli(['--tenant', 'alfa', 'orders', 'export', '--format', 'csv'], alfaHome),
    'personalised order export csv',
    ordersExportOutputSchema,
  );
  const [exportHeader, ...exportRows] = csvExport.content.split('\n');
  assert(
    exportHeader?.endsWith(',personalization,cancel_reason,refunded_amount') === true
      && exportRows.some((row) => row.includes('"engraving@together.dev"') && row.endsWith(`,"${engravingSummary}","","0"`)),
    `order export should end with the personalisation, cancel reason and refunded amount columns: ${csvExport.content}`,
  );
  const jsonExport = expectOk(
    await cli(['--tenant', 'alfa', 'orders', 'export', '--format', 'json'], alfaHome),
    'personalised order export json',
    ordersExportOutputSchema,
  );
  const exportedOrders = z.array(z.object({ id: z.string(), personalization: z.string() }).passthrough())
    .parse(readJson(jsonExport.content, 'order export json'));
  assert(
    exportedOrders.find((order) => order.id === bookOrderId)?.personalization === engravingSummary,
    `json order export should carry the personalisation: ${jsonExport.content}`,
  );
  const corrected = expectOk(
    await cli(['--tenant', 'alfa', 'orders', 'personalization', bookOrderId, book.id, '--text', 'For Ann and Bo'], alfaHome),
    'personalisation correction',
    orderFulfilmentContracts.correctOrderPersonalization.output,
  ).order;
  const correctedLine = corrected.lines?.find((line) => line.productId === book.id)?.personalization;
  assert(
    correctedLine?.text === 'For Ann and Bo' && correctedLine.originalText === engravingText && correctedLine.editedBy !== undefined,
    `staff correction should keep the original text: ${JSON.stringify(corrected)}`,
  );

  const bookmark = expectOk(
    await cli([
      '--tenant', 'alfa', 'product', 'create', '--title', 'Signed bookmark', '--type', 'physical', '--price-cents', '0',
      '--currency', 'PLN', '--vat-rate', '5', '--personalization-file', engravingPath,
    ], alfaHome),
    'free personalised product create',
    productsCreateOutputSchema,
  ).product;
  expectOk(
    await cli(['--tenant', 'alfa', 'price', 'add', '--product', bookmark.id, '--kind', 'one_time', '--price-cents', '0'], alfaHome),
    'free personalised price add',
    productPriceCreateOutputSchema,
  );
  expectOk(await cli(['--tenant', 'alfa', 'product', 'publish', bookmark.id], alfaHome), 'free personalised publish', productsPublishOutputSchema);
  const bookmarkLink = expectOk(
    await cli(['--tenant', 'alfa', 'sales-link', 'create', '--input', JSON.stringify({
      slug: 'signed-bookmark', title: 'Signed bookmark', heading: 'Signed bookmark', productIds: [bookmark.id], active: true,
    })], alfaHome),
    'free personalised sales link create',
    salesLinkContracts.createSalesLink.output,
  ).salesLink;
  const legal = new pg.Client({ connectionString: verifyDatabaseUrl });
  await legal.connect();
  try {
    await legal.query(
      'update tenants set terms_url = $1, privacy_url = $2 where id = $3',
      ['https://alfa.test/terms', 'https://alfa.test/privacy', alfaTenant.tenant.id],
    );
  } finally {
    await legal.end();
  }
  const dedication = 'To <Ann> & "Bo"';
  const freeCheckout = expectOk(
    await cli([
      '--tenant', 'alfa', 'checkout', 'session', '--sales-link', bookmarkLink.id, '--product', bookmark.id,
      '--email', 'dedication@together.dev', '--language', 'en', '--accept-terms', '--personalization', `${bookmark.id}:${dedication}`, '--accept-condition',
    ], anonHome),
    'free personalised sales link checkout',
    checkoutSessionOutputSchema,
  );
  assert(new URL(freeCheckout.url).searchParams.get('status') === 'success', `free checkout should succeed: ${freeCheckout.url}`);
  const dedicationOrders = expectOk(
    await cli(['--tenant', 'alfa', 'orders', 'list', '--search', 'dedication@together.dev'], alfaHome),
    'free personalised order',
    ordersListOutputSchema,
  );
  assert(
    dedicationOrders.orders.some((order) => order.lines?.some((line) => line.productId === bookmark.id
      && line.personalization?.text === dedication && line.personalization.label === 'Add a dedication')),
    `free order line should carry the personalisation: ${JSON.stringify(dedicationOrders.orders)}`,
  );
  let confirmation: z.output<typeof devEmailResultSchema>['email'] = null;
  const confirmationDeadline = Date.now() + 10000;
  while (Date.now() < confirmationDeadline && confirmation === null) {
    confirmation = expectOk(
      await cli(['--tenant', 'alfa', 'dev', 'email', '--to', 'dedication@together.dev'], anonHome),
      'purchase confirmation inspect',
      devEmailResultSchema,
    ).email;
    if (confirmation === null) await delay(100);
  }
  assert(confirmation !== null, 'the free personalised purchase should send a purchase confirmation');
  assert(
    confirmation.html.includes('Personalisation: Signed bookmark')
      && confirmation.html.includes('To &lt;Ann&gt; &amp; &quot;Bo&quot;')
      && !confirmation.html.includes(dedication)
      && confirmation.html.includes(`Condition you accepted: ${engraving.condition}`),
    `purchase confirmation html should carry the escaped personalisation: ${confirmation.html}`,
  );
  assert(
    confirmation.text.includes(`Personalisation: Signed bookmark\n${dedication}\nCondition you accepted: ${engraving.condition}`),
    `purchase confirmation text should carry the personalisation: ${confirmation.text}`,
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
