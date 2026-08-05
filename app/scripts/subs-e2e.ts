import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { z } from 'zod';

import {
  API_PATHS,
  EXIT_CODE_BY_ERROR_CODE,
  TENANT_HEADER,
  emailSendDetailOutputSchema,
  emailSendsOutputSchema,
  looseEnvelopeSchema,
  myProductsOutputSchema,
  ordersExportOutputSchema,
  ordersListOutputSchema,
  productPriceCreateOutputSchema,
  productsCreateOutputSchema,
  productsPublishOutputSchema,
  publicOfferOutputSchema,
  salesSummaryOutputSchema,
  simulatePurchaseOutputSchema,
  stripeWebhookOutputSchema,
  subscriptionSimulateOutputSchema,
  tenantCreateOutputSchema,
  tenantSecretSetOutputSchema,
} from '#core/contract/index.js';
import { SUBSCRIPTION_GRACE_DAYS, orderListItemSchema } from '#core/domain/index.js';

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

type Run = RunResult;

const verifyContainer = 'together-subs-verify-pg';
const verifyPort = 49218;
const managedDatabaseUrl = `postgres://together:together@localhost:${verifyPort}/together`;
const verifyDatabaseUrl = process.env['E2E_DATABASE_URL'] ?? managedDatabaseUrl;
const managesPostgres = process.env['E2E_DATABASE_URL'] === undefined;
const webhookSecret = 'whsec_subs_e2e_test';

const DAY_MS = 24 * 60 * 60 * 1000;

class SubsE2eFailure extends Error {}

const fail = (message: string): never => {
  throw new SubsE2eFailure(message);
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new SubsE2eFailure(message);
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
    `${verifyPort}:5432`,
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
const cliConfigSchema = z.object({
  profiles: z.record(
    z.string(),
    z.object({ token: z.string().min(1).nullable() }),
  ),
});

const iso = (ms: number): string => new Date(ms).toISOString();

const epochSeconds = (isoString: string): number => Math.floor(Date.parse(isoString) / 1000);

const expectCalendarMonthAway = (fromMs: number, periodEnd: string, label: string): void => {
  const expected = new Date(fromMs);
  expected.setUTCMonth(expected.getUTCMonth() + 1);
  assert(
    Math.abs(Date.parse(periodEnd) - expected.getTime()) < 10 * 60 * 1000,
    `${label}: expected ~${expected.toISOString()}, got ${periodEnd}`,
  );
};

const graceIso = (periodEnd: string): string =>
  iso(Date.parse(periodEnd) + SUBSCRIPTION_GRACE_DAYS * DAY_MS);

interface WebhookObject {
  id: string;
  subscription?: string;
  amount_total?: number;
  currency?: string;
  period_end?: number;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  status?: string;
}

const webhookPayload = (eventId: string, type: string, object: WebhookObject): string =>
  JSON.stringify({ id: eventId, type, data: { object } });

const driveScenario = async (port: number, homes: string[]): Promise<number> => {
  let steps = 0;
  const url = `http://localhost:${port}`;
  const staffHome = mkdtempSync(join(tmpdir(), 'subs-e2e-staff-'));
  const memberHome = mkdtempSync(join(tmpdir(), 'subs-e2e-member-'));
  const anonHome = mkdtempSync(join(tmpdir(), 'subs-e2e-anon-'));
  homes.push(staffHome, memberHome, anonHome);
  const cli = (args: string[], home: string): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', '--json', '--api-url', url, ...args], { HOME: home });
  const staff = (args: string[]): Promise<Run> => cli(['--tenant', 'subs', ...args], staffHome);
  const member = (args: string[]): Promise<Run> => cli(['--tenant', 'subs', ...args], memberHome);
  const db = new pg.Client({ connectionString: verifyDatabaseUrl });
  await db.connect();

  try {
    const registered = expectOk(
      await cli(
        [
          'register',
          '--name',
          'Subs Creator',
          '--email',
          'creator@subs.dev',
          '--password',
          passwordFixture('Demo1234!'),
        ],
        staffHome,
      ),
      'creator register',
      authSchema,
    );
    assert(registered.token !== null, 'creator registration should store a token');
    const tenant = expectOk(
      await cli(['tenant', 'create', 'Subs Lab', '--slug', 'subs'], staffHome),
      'tenant create',
      tenantCreateOutputSchema,
    ).tenant;
    assert(tenant.slug === 'subs', 'tenant slug mismatch');
    steps += 1;

    const product = expectOk(
      await staff(['product', 'create', '--title', 'Klub Subs', '--price-cents', '9900', '--currency', 'PLN']),
      'product create',
      productsCreateOutputSchema,
    ).product;
    expectOk(await staff(['product', 'publish', product.id]), 'product publish', productsPublishOutputSchema);
    const oneTimePrice = expectOk(
      await staff(['price', 'add', '--product', product.id, '--kind', 'one_time', '--price-cents', '9900']),
      'one-time price add',
      productPriceCreateOutputSchema,
    ).price;
    const monthlyPrice = expectOk(
      await staff([
        'price', 'add', '--product', product.id, '--kind', 'recurring', '--interval', 'month', '--price-cents', '2900',
      ]),
      'monthly price add',
      productPriceCreateOutputSchema,
    ).price;
    assert(monthlyPrice.kind === 'recurring' && monthlyPrice.interval === 'month', 'monthly price shape mismatch');
    expectError(
      await staff(['price', 'add', '--product', product.id, '--kind', 'recurring', '--price-cents', '900']),
      'recurring price without interval',
      EXIT_CODE_BY_ERROR_CODE.validation,
      'validation',
    );
    const offer = expectOk(
      await cli(['--tenant', 'subs', 'public', 'offer'], anonHome),
      'public offer',
      publicOfferOutputSchema,
    );
    const offerPrices = offer.products.find((item) => item.id === product.id)?.prices ?? [];
    assert(offerPrices.length === 2, `offer should expose 2 active prices, got ${offerPrices.length}`);
    steps += 1;

    const purchase = expectOk(
      await staff(['simulate-purchase', '--email', 'abonent@subs.dev', '--product', product.id, '--price-id', monthlyPrice.id]),
      'subscription purchase',
      simulatePurchaseOutputSchema,
    );
    assert(!purchase.alreadyOwned, 'first subscription purchase should not be alreadyOwned');
    assert(purchase.subscriptionId !== null, 'subscription purchase should create a subscription');
    assert(purchase.orderId !== null, 'subscription purchase should append an order');
    const subscriptionId = purchase.subscriptionId;

    const replayPurchase = expectOk(
      await staff(['simulate-purchase', '--email', 'abonent@subs.dev', '--product', product.id, '--price-id', monthlyPrice.id]),
      'subscription purchase replay',
      simulatePurchaseOutputSchema,
    );
    assert(replayPurchase.alreadyOwned, 'replayed subscription purchase should be alreadyOwned');
    assert(replayPurchase.subscriptionId === subscriptionId, 'replay should resolve the same subscription');
    assert(replayPurchase.orderId === null, 'replay must not append another order');

    const afterPurchase = expectOk(await staff(['orders', 'list']), 'orders after purchase', ordersListOutputSchema);
    assert(afterPurchase.total === 1, `expected 1 order after purchase, got ${afterPurchase.total}`);
    assert(
      afterPurchase.orders[0]?.status === 'paid' && afterPurchase.orders[0].kind === 'recurring',
      'first order should be a paid recurring order',
    );
    steps += 1;

    expectOk(
      await member(['login-magic', '--email', 'abonent@subs.dev']),
      'member magic login',
      authSchema,
    );
    const initialProducts = expectOk(await member(['my', 'products']), 'my products initial', myProductsOutputSchema);
    const initial = initialProducts.products.find((item) => item.id === product.id);
    assert(initial !== undefined, 'member should see the subscribed product');
    assert(initial.grantStatus === 'active', 'grant should be active after purchase');
    assert(initial.subscription?.status === 'active', 'subscription chip should be active');
    assert(!initial.subscription.cancelAtPeriodEnd, 'subscription should not be cancelling yet');
    const initialPeriodEnd = initial.subscription.currentPeriodEnd;
    expectCalendarMonthAway(Date.now(), initialPeriodEnd, 'initial period end should be one month out');
    assert(
      initial.grantExpiresAt === graceIso(initialPeriodEnd),
      `grant should expire at period end + ${SUBSCRIPTION_GRACE_DAYS}d grace: ${String(initial.grantExpiresAt)} vs ${graceIso(initialPeriodEnd)}`,
    );
    steps += 1;

    const cycled = expectOk(
      await staff(['subscription', 'simulate-cycle', subscriptionId]),
      'invoice cycle',
      subscriptionSimulateOutputSchema,
    );
    assert(cycled.processed, 'invoice cycle should process');
    assert(cycled.subscription.status === 'active', 'subscription should stay active after cycle');
    assert(
      Date.parse(cycled.subscription.currentPeriodEnd) > Date.parse(initialPeriodEnd),
      'invoice cycle should extend the period',
    );
    const providerSubscriptionId = cycled.subscription.providerSubscriptionId;
    assert(providerSubscriptionId !== null, 'simulated subscription should carry a provider id');

    const afterCycle = expectOk(await staff(['orders', 'list']), 'orders after cycle', ordersListOutputSchema);
    assert(afterCycle.total === 2, `expected 2 orders after cycle, got ${afterCycle.total}`);
    const cycleProducts = expectOk(await member(['my', 'products']), 'my products after cycle', myProductsOutputSchema);
    const afterCycleProduct = cycleProducts.products.find((item) => item.id === product.id);
    assert(
      afterCycleProduct?.grantExpiresAt === graceIso(cycled.subscription.currentPeriodEnd),
      'grant should be extended to the new period end + grace',
    );
    steps += 1;

    expectOk(
      await staff(['tenant-secret', 'set', 'stripe.webhookSecret', webhookSecret]),
      'webhook secret set',
      tenantSecretSetOutputSchema,
    );
    const invoiceEvent = webhookPayload('evt_subs_e2e_1', 'invoice.paid', {
      id: 'in_subs_e2e_1',
      subscription: providerSubscriptionId,
      amount_total: 2900,
      currency: 'pln',
      period_end: Math.floor((Date.parse(cycled.subscription.currentPeriodEnd) + 30 * DAY_MS) / 1000),
    });
    const deliver = (event: string): Promise<Run> =>
      staff(['stripe', 'deliver-webhook', '--tenant-id', tenant.id, '--webhook-secret', webhookSecret, '--event', event]);
    const firstDelivery = expectOk(await deliver(invoiceEvent), 'invoice webhook', stripeWebhookOutputSchema);
    assert(firstDelivery.processed, 'first invoice webhook should process');
    const replayDelivery = expectOk(await deliver(invoiceEvent), 'invoice webhook replay', stripeWebhookOutputSchema);
    assert(!replayDelivery.processed, 'replayed webhook event must be skipped');
    const retryDelivery = expectOk(
      await deliver(
        webhookPayload('evt_subs_e2e_1_retry', 'invoice.paid', {
          id: 'in_subs_e2e_1',
          subscription: providerSubscriptionId,
          amount_total: 2900,
          currency: 'pln',
        }),
      ),
      'invoice webhook retry with a fresh event id',
      stripeWebhookOutputSchema,
    );
    assert(!retryDelivery.processed, 'same invoice under a new event id must be skipped');
    const afterWebhook = expectOk(await staff(['orders', 'list']), 'orders after webhook', ordersListOutputSchema);
    assert(afterWebhook.total === 3, `expected 3 orders after webhook cycle, got ${afterWebhook.total}`);
    assert(
      afterWebhook.orders.filter((order) => order.status === 'paid').length === 3,
      'all three orders should be paid so far',
    );
    steps += 1;

    const failed = expectOk(
      await staff(['subscription', 'simulate-failure', subscriptionId]),
      'payment failure',
      subscriptionSimulateOutputSchema,
    );
    assert(failed.processed, 'payment failure should process');
    assert(failed.subscription.status === 'past_due', 'subscription should be past_due after failure');
    const pastDuePeriodEnd = failed.subscription.currentPeriodEnd;

    const afterFailure = expectOk(await staff(['orders', 'list']), 'orders after failure', ordersListOutputSchema);
    assert(afterFailure.total === 4, `expected 4 orders after failure, got ${afterFailure.total}`);
    const failedOrders = expectOk(
      await staff(['orders', 'list', '--status', 'failed']),
      'failed orders filter',
      ordersListOutputSchema,
    );
    assert(failedOrders.total === 1 && failedOrders.orders[0]?.status === 'failed', 'exactly one failed order expected');

    const pastDueProducts = expectOk(await member(['my', 'products']), 'my products past_due', myProductsOutputSchema);
    const pastDue = pastDueProducts.products.find((item) => item.id === product.id);
    assert(pastDue?.subscription?.status === 'past_due', 'member should see the past_due chip');
    assert(pastDue.grantStatus === 'active', 'access should continue until period end + grace while past_due');
    assert(
      pastDue.grantExpiresAt === graceIso(pastDuePeriodEnd),
      'failure must not extend the grant beyond the paid period + grace',
    );
    steps += 1;

    const oneTimePurchase = expectOk(
      await staff(['simulate-purchase', '--email', 'kupiec@subs.dev', '--product', product.id, '--price-id', oneTimePrice.id]),
      'one-time purchase',
      simulatePurchaseOutputSchema,
    );
    assert(oneTimePurchase.subscriptionId === null, 'one-time purchase must not create a subscription');
    assert(oneTimePurchase.orderId !== null, 'one-time purchase should append an order');
    const oneTimeReplay = expectOk(
      await staff(['simulate-purchase', '--email', 'kupiec@subs.dev', '--product', product.id, '--price-id', oneTimePrice.id]),
      'one-time purchase replay',
      simulatePurchaseOutputSchema,
    );
    assert(oneTimeReplay.alreadyOwned && oneTimeReplay.orderId === null, 'one-time replay must not duplicate the order');

    const oneTimeOrders = expectOk(
      await staff(['orders', 'list', '--kind', 'one_time']),
      'one-time kind filter',
      ordersListOutputSchema,
    );
    assert(oneTimeOrders.total === 1, `expected 1 one-time order, got ${oneTimeOrders.total}`);
    const searchOrders = expectOk(
      await staff(['orders', 'list', '--search', 'abonent@subs.dev']),
      'orders search',
      ordersListOutputSchema,
    );
    assert(searchOrders.total === 4, `search by member email should find 4 orders, got ${searchOrders.total}`);
    const productFilter = expectOk(
      await staff(['orders', 'list', '--product', product.id, '--status', 'paid']),
      'orders product+status filter',
      ordersListOutputSchema,
    );
    assert(productFilter.total === 4, `paid orders for the product should be 4, got ${productFilter.total}`);
    steps += 1;

    const summary = expectOk(await staff(['orders', 'summary']), 'sales summary', salesSummaryOutputSchema).summary;
    assert(summary.ordersLast30Days === 5, `expected 5 orders in summary, got ${summary.ordersLast30Days}`);
    assert(summary.activeSubscriptions === 1, `expected 1 active subscription, got ${summary.activeSubscriptions}`);
    const plnRevenue = summary.revenueLast30Days.find((entry) => entry.currency === 'PLN');
    assert(
      plnRevenue?.amountCents === 3 * 2900 + 9900,
      `revenue should count paid orders only (18600), got ${String(plnRevenue?.amountCents)}`,
    );
    steps += 1;

    const config = cliConfigSchema.parse(
      readJson(readFileSync(join(staffHome, '.config/together/config.json'), 'utf8'), 'staff cli config'),
    );
    const token = config.profiles[new URL(url).origin]?.token;
    assert(token !== undefined && token !== null, 'staff cli config should contain the active origin token');
    const exportFetch = async (format: 'csv' | 'json'): Promise<z.output<typeof ordersExportOutputSchema>> => {
      const response = await fetch(`${url}${API_PATHS.ordersExport}?format=${format}`, {
        headers: { [TENANT_HEADER]: 'subs', authorization: `Bearer ${token}` },
      });
      assert(response.status === 200, `orders export ${format} expected 200, got ${response.status}`);
      const envelope = looseEnvelopeSchema.parse(await response.json());
      assert(envelope.ok, `orders export ${format} should return an ok envelope`);
      return ordersExportOutputSchema.parse(envelope.data);
    };
    const csvExport = await exportFetch('csv');
    const csvLines = csvExport.content.split('\n');
    assert(csvLines.length === 6, `csv export should have header + 5 rows, got ${csvLines.length}`);
    assert(
      csvExport.content.includes('abonent@subs.dev') && csvExport.content.includes('kupiec@subs.dev'),
      'csv export should include both buyers',
    );
    const jsonExport = await exportFetch('json');
    const exportedOrders = z.array(orderListItemSchema).parse(readJson(jsonExport.content, 'json export content'));
    assert(exportedOrders.length === 5, `json export should have all 5 orders, got ${exportedOrders.length}`);
    expectError(
      await member(['orders', 'list']),
      'member cannot read the sales ledger',
      EXIT_CODE_BY_ERROR_CODE.forbidden,
      'forbidden',
    );
    steps += 1;

    const cancelPeriodEnd = iso(epochSeconds(pastDuePeriodEnd) * 1000);
    const cancelEvent = webhookPayload('evt_subs_e2e_cancel', 'customer.subscription.updated', {
      id: providerSubscriptionId,
      cancel_at_period_end: true,
      status: 'active',
      current_period_end: epochSeconds(cancelPeriodEnd),
    });
    const cancelDelivery = expectOk(await deliver(cancelEvent), 'cancel webhook', stripeWebhookOutputSchema);
    assert(cancelDelivery.processed, 'cancel webhook should process');
    const cancelReplay = expectOk(await deliver(cancelEvent), 'cancel webhook replay', stripeWebhookOutputSchema);
    assert(!cancelReplay.processed, 'replayed cancel webhook must be skipped');

    const cancellingProducts = expectOk(await member(['my', 'products']), 'my products cancelling', myProductsOutputSchema);
    const cancelling = cancellingProducts.products.find((item) => item.id === product.id);
    assert(cancelling?.subscription?.cancelAtPeriodEnd === true, 'member should see cancelAtPeriodEnd');
    assert(
      cancelling.subscription.currentPeriodEnd === cancelPeriodEnd,
      'cancel webhook must adopt the paid period end it reports',
    );
    assert(
      cancelling.grantExpiresAt === cancelPeriodEnd,
      'cancel webhook must expire the grant at the paid period end',
    );

    const finalCycle = expectOk(
      await staff(['subscription', 'simulate-cycle', subscriptionId]),
      'cycle after cancel',
      subscriptionSimulateOutputSchema,
    );
    assert(finalCycle.subscription.status === 'canceled', 'cycling a cancelling subscription should cancel it');
    const sendsResponse = await fetch(`${url}${API_PATHS.emailSends}?kind=transactional`, {
      headers: { [TENANT_HEADER]: 'subs', authorization: `Bearer ${token}` },
    });
    assert(sendsResponse.status === 200, `transactional sends expected 200, got ${sendsResponse.status}`);
    const sendsEnvelope = looseEnvelopeSchema.parse(await sendsResponse.json());
    assert(sendsEnvelope.ok, 'transactional sends should return an ok envelope');
    const sends = emailSendsOutputSchema.parse(sendsEnvelope.data).sends;
    const lapseSend = sends.find((send) => send.source === 'subscription-ended');
    assert(lapseSend !== undefined, 'subscription lapse should appear in transactional sends');
    const detailPath = API_PATHS.emailSend
      .replace(':kind', 'transactional')
      .replace(':id', lapseSend.id);
    const detailResponse = await fetch(`${url}${detailPath}`, {
      headers: { [TENANT_HEADER]: 'subs', authorization: `Bearer ${token}` },
    });
    assert(detailResponse.status === 200, `transactional send detail expected 200, got ${detailResponse.status}`);
    const detailEnvelope = looseEnvelopeSchema.parse(await detailResponse.json());
    assert(detailEnvelope.ok, 'transactional send detail should return an ok envelope');
    const detail = emailSendDetailOutputSchema.parse(detailEnvelope.data);
    assert(detail.events[0]?.type === 'queued', 'subscription lapse timeline should start at queued');
    const afterCancel = expectOk(await staff(['orders', 'list']), 'orders after cancel', ordersListOutputSchema);
    assert(afterCancel.total === 5, `cancel must not append orders, got ${afterCancel.total}`);
    expectError(
      await staff(['subscription', 'simulate-cycle', subscriptionId]),
      'cycling a canceled subscription',
      EXIT_CODE_BY_ERROR_CODE.validation,
      'validation',
    );
    steps += 1;

    const canceledProducts = expectOk(await member(['my', 'products']), 'my products canceled', myProductsOutputSchema);
    const canceled = canceledProducts.products.find((item) => item.id === product.id);
    assert(canceled?.subscription?.status === 'canceled', 'member should see the canceled chip');
    assert(canceled.grantStatus === 'active', 'access should persist until the paid period ends after cancel');
    assert(
      canceled.grantExpiresAt === cancelPeriodEnd,
      'canceled access must retain the paid period end without grace',
    );
    steps += 1;

    const pastPeriodEnd = iso(Date.now() - 5 * DAY_MS);
    const subUpdate = await db.query(
      'update member_subscriptions set current_period_end = $1 where id = $2 and tenant_id = $3',
      [pastPeriodEnd, subscriptionId, tenant.id],
    );
    assert(subUpdate.rowCount === 1, 'time travel should update exactly one subscription');
    const grantUpdate = await db.query(
      'update product_grants set expires_at = $1 where tenant_id = $2 and product_id = $3 and member_id = $4',
      [pastPeriodEnd, tenant.id, product.id, purchase.memberId],
    );
    assert(grantUpdate.rowCount === 1, 'time travel should update exactly one grant');

    const expiredProducts = expectOk(await member(['my', 'products']), 'my products expired', myProductsOutputSchema);
    const expired = expiredProducts.products.find((item) => item.id === product.id);
    assert(expired?.grantStatus === 'expired', 'access must expire at read time after the paid period ends');
    const finalSummary = expectOk(await staff(['orders', 'summary']), 'final summary', salesSummaryOutputSchema).summary;
    assert(
      finalSummary.activeSubscriptions === 0,
      `canceled + expired subscription must leave the active tile at 0, got ${finalSummary.activeSubscriptions}`,
    );
    assert(finalSummary.ordersLast30Days === 5, 'order count should be unchanged by expiry');
    const finalOrders = expectOk(await staff(['orders', 'list']), 'final orders', ordersListOutputSchema);
    assert(finalOrders.total === 5, `ledger must still hold 5 orders, got ${finalOrders.total}`);
    steps += 1;

    return steps;
  } finally {
    await db.end().catch(() => undefined);
  }
};

const startedAt = Date.now();
const homes: string[] = [];
let server: ChildProcess | null = null;
let postgresStarted = false;

try {
  console.log('subs-e2e: starting fresh verification Postgres...');
  await startPostgres();
  postgresStarted = true;
  await waitForPostgres();
  console.log('subs-e2e: running migrations...');
  await migrate();
  const port = await ephemeralPort();
  const webDistDir = mkdtempSync(join(tmpdir(), 'subs-e2e-web-'));
  homes.push(webDistDir);
  console.log(`subs-e2e: booting server on port ${port}...`);
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
  console.log('subs-e2e: driving the subscription lifecycle...');
  const steps = await driveScenario(port, homes);
  console.log(`\nsubs-e2e: PASS (${steps} steps, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof SubsE2eFailure ? error.message : String(error);
  console.error(`\nsubs-e2e: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server) await killServer(server);
  for (const dir of homes) rmSync(dir, { recursive: true, force: true });
  if (postgresStarted) await stopPostgres();
}
