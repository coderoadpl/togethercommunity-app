import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { verifyPassword } from 'better-auth/crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuth } from '#adapters/auth/create-auth.js';
import { AUTH_MAGIC_LINK_VERIFICATION_PATH, createAuthE2eClient, type AuthE2eClient } from '#adapters/auth/e2e-http.js';
import { databaseHostFingerprint } from '#adapters/crypto/database-fingerprint.js';
import {
  SMOKE_PURCHASE_PRODUCT,
  SMOKE_PURCHASE_SALES_LINK,
  SMOKE_TENANT_CREATOR_EMAIL,
  SMOKE_TENANT_MEMBER_EMAIL,
  SMOKE_TENANT_PURCHASE_EMAIL,
  SMOKE_TENANT_PURCHASE_USER_ID,
} from '#core/domain/index.js';

import type { Db } from './client.js';
import { createEmailOutboxRepository } from './email-outbox.js';
import * as schema from './schema.js';
import { reseedSmokeTenant, revokePurchaseAccess } from './smoke-tenant-reseed.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const { spawnSync } = process.getBuiltinModule('node:child_process');
const { join } = process.getBuiltinModule('node:path');
const tsxBin = join(process.cwd(), 'node_modules/.bin/tsx');
const DEMO_PASSWORD = 'demo-password-15';
const MEMBER_PASSWORD = 'production-only-member-password';
const CREATOR_PASSWORD = 'production-only-creator-password';
const PURCHASE_PASSWORD = 'production-only-purchase-password';

let testDatabaseUrl: string;
let closeTestDatabase: () => Promise<void>;
let client: pg.Client;
let pool: pg.Pool;
let db: Db;
let seededTemplateName: string;
let closeSeededTemplate: (() => Promise<void>) | undefined;

const runDatabaseScript = (
  script: 'seed.ts' | 'reseed-acme.ts',
  overrides: Record<string, string> = {},
) => spawnSync(tsxBin, [`adapters/db/${script}`], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
    BETTER_AUTH_SECRET: 'seed-integration-secret-at-least-32-characters',
    SEED_BASE_TIME: '2026-07-15T08:00:00.000Z',
    ...overrides,
  },
});

const runSucceeds = (
  script: 'seed.ts' | 'reseed-acme.ts',
  overrides: Record<string, string> = {},
): void => {
  const result = runDatabaseScript(script, overrides);
  expect(result.status, result.stderr || result.stdout).toBe(0);
};

const rowCounts = async (): Promise<Record<string, number>> => {
  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  const counts: Record<string, number> = {};
  for (const { table_name: table } of tables.rows) {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM "${table.replaceAll('"', '""')}"`,
    );
    counts[table] = Number(result.rows[0]?.count ?? 0);
  }
  return counts;
};

const idsOf = async (sql: string): Promise<string[]> => {
  const result = await client.query<{ id: string }>(sql);
  return result.rows.map(({ id }) => id);
};

const credentialHashFor = async (email: string): Promise<string> => {
  const credential = await client.query<{ password: string }>(
    `SELECT a.password
     FROM account a
     JOIN "user" u ON u.id = a.user_id
     WHERE a.provider_id = 'credential' AND u.email = $1`,
    [email],
  );
  return credential.rows[0]?.password ?? '';
};

const purchaseFixtureState = async () => {
  const roles = await client.query<{ role: string }>(
    `SELECT ta.role
     FROM tenant_admins ta
     JOIN "user" u ON u.id = ta.user_id
     WHERE ta.tenant_id = 'tenant-acme' AND u.email = $1`,
    [SMOKE_TENANT_PURCHASE_EMAIL],
  );
  const tenant = await client.query<{ shipping_rates: unknown; terms_url: string | null; privacy_url: string | null }>(
    `SELECT shipping_rates, terms_url, privacy_url FROM tenants WHERE id = 'tenant-acme'`,
  );
  const products = await client.query<{ id: string; type: string; delivery_method: string; price_cents: number; vat_rate: unknown; published: boolean }>(
    `SELECT id, type, delivery_method, price_cents, vat_rate, published
     FROM products WHERE tenant_id = 'tenant-acme' ORDER BY id`,
  );
  const prices = await client.query<{ id: string; amount_cents: number; currency: string; kind: string; active: boolean }>(
    `SELECT id, amount_cents, currency, kind, active
     FROM product_prices WHERE tenant_id = 'tenant-acme' AND product_id = $1`,
    [SMOKE_PURCHASE_PRODUCT.id],
  );
  const stock = await client.query<{ on_hand: number; reserved: number }>(
    `SELECT on_hand, reserved FROM product_stock WHERE tenant_id = 'tenant-acme' AND product_id = $1`,
    [SMOKE_PURCHASE_PRODUCT.id],
  );
  const links = await client.query<{ id: string; slug: string; product_ids: unknown; active: boolean; listed: boolean; revision: number }>(
    `SELECT id, slug, product_ids, active, listed, revision FROM sales_links WHERE tenant_id = 'tenant-acme'`,
  );
  const linkEvents = await client.query<{ type: string; revision: number }>(
    `SELECT type, revision FROM sales_link_events WHERE tenant_id = 'tenant-acme'`,
  );
  return {
    roles: roles.rows.map((row) => row.role),
    tenant: tenant.rows[0],
    products: products.rows,
    prices: prices.rows,
    stock: stock.rows,
    links: links.rows,
    linkEvents: linkEvents.rows,
  };
};

const addForeignMember = async (): Promise<void> => {
  await client.query(
    `INSERT INTO members (id, tenant_id, user_id, email, display_name, created_at)
     VALUES ('member-acme-real', 'tenant-acme', 'user-real', 'buyer@example.com', 'Buyer', NOW()::text)`,
  );
};

const addForeignMarketingConsent = async (): Promise<void> => {
  await client.query(
    `INSERT INTO consent_definitions (
       id, tenant_id, key, kind, channel, document_ref, created_at, updated_at
     ) VALUES (
       'consent-def-acme', 'tenant-acme', 'newsletter', 'optional_marketing', 'email',
       '{"documentId":"doc-acme","versionId":"doc-acme-v1"}'::jsonb, NOW(), NOW()
     )`,
  );
  await client.query(
    `INSERT INTO marketing_consents (
       id, tenant_id, email, definition_id, definition_version, wording_snapshot,
       document_ref_snapshot, status, source, evidence, occurred_at
     ) VALUES (
       'consent-acme-real', 'tenant-acme', 'zapisany@gmail.com', 'consent-def-acme', 1,
       'Zgoda marketingowa', '{"documentId":"doc-acme","versionId":"doc-acme-v1","version":1}'::jsonb,
       'granted', 'checkout', '{"ip":"127.0.0.1","userAgent":"seed","capturedAt":"2026-07-15T08:00:00.000Z"}'::jsonb,
       NOW()
     )`,
  );
};

const userIdFor = async (email: string): Promise<string> => {
  const found = await client.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email]);
  return found.rows[0]?.id ?? '';
};

const grantSignIns = async (userId: string, suffix: string): Promise<void> => {
  await client.query(
    `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id)
     VALUES ($1, NOW() + INTERVAL '7 days', $2, NOW(), NOW(), $3)`,
    [`session-${suffix}`, `token-${suffix}`, userId],
  );
  await client.query(
    `INSERT INTO passkey (id, public_key, user_id, credential_id, counter, device_type, backed_up)
     VALUES ($1, 'public-key', $2, $3, 0, 'singleDevice', false)`,
    [`passkey-${suffix}`, userId, `credential-${suffix}`],
  );
  await client.query(
    `INSERT INTO two_factor (id, secret, backup_codes, user_id) VALUES ($1, 'secret', 'codes', $2)`,
    [`two-factor-${suffix}`, userId],
  );
  await client.query(
    `INSERT INTO account (id, account_id, provider_id, user_id, created_at, updated_at)
     VALUES ($1, $2, 'google', $3, NOW(), NOW())`,
    [`account-google-${suffix}`, `google-${suffix}`, userId],
  );
  await client.query(`UPDATE "user" SET two_factor_enabled = true WHERE id = $1`, [userId]);
};

const signInsOf = async (userId: string) => {
  const ids = async (table: string): Promise<string[]> => {
    const rows = await client.query<{ id: string }>(
      `SELECT id FROM "${table}" WHERE user_id = $1 ORDER BY id`,
      [userId],
    );
    return rows.rows.map(({ id }) => id);
  };
  const accounts = await client.query<{ provider_id: string }>(
    `SELECT provider_id FROM account WHERE user_id = $1 ORDER BY provider_id`,
    [userId],
  );
  const flags = await client.query<{ two_factor_enabled: boolean | null }>(
    `SELECT two_factor_enabled FROM "user" WHERE id = $1`,
    [userId],
  );
  return {
    sessions: await ids('session'),
    passkeys: await ids('passkey'),
    twoFactors: await ids('two_factor'),
    providers: accounts.rows.map((row) => row.provider_id),
    twoFactorEnabled: flags.rows[0]?.two_factor_enabled ?? null,
  };
};

const revokedPurchaseAccount = {
  sessions: [],
  passkeys: [],
  twoFactors: [],
  providers: [],
  twoFactorEnabled: false,
};

const reseededPurchaseAccount = { ...revokedPurchaseAccount, providers: ['credential'] };

const withPurchase = { SMOKE_PURCHASE_PASSWORD: PURCHASE_PASSWORD };

const seedPurchaseAccountWithSignIns = async (): Promise<string> => {
  runSucceeds('reseed-acme.ts', withPurchase);
  await grantSignIns(SMOKE_TENANT_PURCHASE_USER_ID, 'purchase');
  const creatorUserId = await userIdFor(SMOKE_TENANT_CREATOR_EMAIL);
  await grantSignIns(creatorUserId, 'creator');
  return creatorUserId;
};

const untouchedCreatorSignIns = {
  sessions: ['session-creator'],
  passkeys: ['passkey-creator'],
  twoFactors: ['two-factor-creator'],
  providers: ['credential', 'google'],
  twoFactorEnabled: true,
};

const AUTH_ORIGIN = 'http://localhost:48730';
let requestCount = 0;

const authHandler = () => createAuth(db, {
  secret: 'seed-integration-secret-at-least-32-characters',
  baseUrl: AUTH_ORIGIN,
  baseDomain: 'localhost',
  singleTenantMode: false,
  trustedOrigins: () => [AUTH_ORIGIN],
  secureCookies: false,
  exposeMagicLinks: false,
  emailOutbox: createEmailOutboxRepository(db),
  emailSender: { send: async () => ({ ok: true, value: { messageId: 'reseed-test', transport: 'platform' as const } }) },
  authSendLog: { queue: async () => ({ ok: true, value: undefined }), settle: async () => ({ ok: true, value: undefined }) },
  ids: { nextId: () => crypto.randomUUID() },
  clock: { nowIso: () => new Date().toISOString() },
  dispatchEmail: () => undefined,
  defaultTenantName: 'Together',
  google: null,
}).handler;

const authHttp = (): AuthE2eClient => {
  const handler = authHandler();
  requestCount += 1;
  return createAuthE2eClient({
    connectUrl: AUTH_ORIGIN,
    origin: AUTH_ORIGIN,
    headers: { 'x-forwarded-for': `198.51.100.${String(requestCount % 250)}` },
    request: async (input, init) => handler(new Request(input, init)),
  });
};

const magicLinkIdentifiers = async (): Promise<string[]> =>
  idsOf(`SELECT identifier AS id FROM verification WHERE identifier LIKE 'magic-link:%' ORDER BY identifier`);

const issueMagicLink = async (email: string): Promise<string> => {
  const before = new Set(await magicLinkIdentifiers());
  const requested = await authHttp().requestMagicLink({
    email,
    callbackURL: `${AUTH_ORIGIN}/`,
    errorCallbackURL: `${AUTH_ORIGIN}/login`,
  });
  expect(requested.status).toBe(200);
  const issued = (await magicLinkIdentifiers()).find((identifier) => !before.has(identifier)) ?? '';
  return issued.slice('magic-link:'.length);
};

const purchaseSignInStatus = async (): Promise<number> =>
  (await authHttp().signInEmail({ email: SMOKE_TENANT_PURCHASE_EMAIL, password: PURCHASE_PASSWORD })).status;

const resetPasswordStatus = async (token: string, newPassword: string): Promise<number> =>
  (await authHttp().resetPassword({ token, newPassword })).status;

const issueResetToken = async (userId: string, token: string): Promise<void> => {
  await client.query(
    `INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour', NOW(), NOW())`,
    [`verification-${token}`, `reset-password:${token}`, userId],
  );
};

const purchasePasswords = { member: DEMO_PASSWORD, creator: DEMO_PASSWORD, purchase: PURCHASE_PASSWORD };

beforeAll(async () => {
  const template = await createTestDatabase('together_acme_reseed_fixture', baseDatabaseUrl);
  closeSeededTemplate = template.close;
  testDatabaseUrl = template.url;
  runSucceeds('seed.ts');
  seededTemplateName = await template.makeTemplate();
}, 180_000);

afterAll(async () => {
  await closeSeededTemplate?.();
}, 180_000);

beforeEach(async () => {
  const testDatabase = await createTestDatabase('together_acme_reseed_test', baseDatabaseUrl, seededTemplateName);
  testDatabaseUrl = testDatabase.url;
  closeTestDatabase = testDatabase.close;
  client = new pg.Client({ connectionString: testDatabaseUrl });
  await client.connect();
  pool = new pg.Pool({ connectionString: testDatabaseUrl });
  db = drizzle(pool, { schema });
}, 180_000);

afterEach(async () => {
  await client.end();
  await pool.end();
  await closeTestDatabase();
}, 180_000);

describe('smoke tenant reseed', () => {
  it('rebuilds the smoke tenant and leaves the other demo tenants untouched', async () => {
    await client.query(
      `INSERT INTO courses (id, tenant_id, name, description, created_at)
       VALUES ('AUDYT-acme', 'tenant-acme', 'AUDYT acme', '', NOW()),
              ('AUDYT-studio', 'tenant-studio', 'AUDYT studio', '', NOW())`,
    );

    runSucceeds('reseed-acme.ts');

    expect(await idsOf(`SELECT id FROM courses WHERE tenant_id = 'tenant-acme' ORDER BY id`))
      .toEqual(['course-acme']);
    expect(await idsOf(`SELECT id FROM courses WHERE id = 'AUDYT-studio'`))
      .toEqual(['AUDYT-studio']);
    expect(await idsOf(`SELECT id FROM tenants ORDER BY id`))
      .toEqual(['tenant-acme', 'tenant-akademia', 'tenant-studio']);
    expect(await idsOf(
      `SELECT email AS id FROM members WHERE tenant_id = 'tenant-acme' ORDER BY email`,
    )).toEqual([SMOKE_TENANT_MEMBER_EMAIL, 'student2@together.dev']);
  }, 180_000);

  it('grants the smoke member access that is already active when the reseed commits', async () => {
    runSucceeds('reseed-acme.ts');

    expect(await idsOf(
      `SELECT id FROM product_grants WHERE tenant_id = 'tenant-acme' ORDER BY id`,
    )).toEqual(['grant-acme-smoke']);
    expect(await idsOf(
      `SELECT id FROM product_grants
       WHERE tenant_id = 'tenant-acme' AND starts_at::timestamptz <= NOW()
       ORDER BY id`,
    )).toEqual(['grant-acme-smoke']);
  }, 180_000);

  it('repeats without adding rows', async () => {
    runSucceeds('reseed-acme.ts');
    const firstCounts = await rowCounts();

    runSucceeds('reseed-acme.ts');

    expect(await rowCounts()).toEqual(firstCounts);
  }, 180_000);

  it('queues no e-mail while creating the fixture accounts', async () => {
    const queuedForFixture = async (): Promise<string[]> => idsOf(
      `SELECT "to" AS id
       FROM email_outbox
       WHERE ("to" LIKE '%@together.dev' OR "to" LIKE 'kontakt+smoke-%')
         AND tenant_id IS NULL
       ORDER BY "to"`,
    );

    expect(await queuedForFixture()).toEqual([]);

    runSucceeds('reseed-acme.ts');

    expect(await queuedForFixture()).toEqual([]);
  }, 180_000);

  it('refuses to wipe a tenant a real person joined', async () => {
    await addForeignMember();

    const result = runDatabaseScript('reseed-acme.ts');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('has a member outside @together.dev and the smoke accounts');
    expect(await idsOf(`SELECT id FROM members WHERE id = 'member-acme-real'`))
      .toEqual(['member-acme-real']);
  }, 180_000);

  it('refuses to erase a marketing consent left by a real person', async () => {
    await addForeignMarketingConsent();

    const result = runDatabaseScript('reseed-acme.ts');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('holds a marketing consent outside @together.dev and the smoke accounts');
    expect(await idsOf(
      `SELECT id FROM marketing_consents WHERE tenant_id = 'tenant-acme' ORDER BY id`,
    )).toEqual(['consent-acme-real']);
  }, 180_000);

  it('refuses the demo password when DATABASE_URL is the production database', async () => {
    const result = runDatabaseScript('reseed-acme.ts', {
      PRODUCTION_DATABASE_FINGERPRINT: databaseHostFingerprint(testDatabaseUrl) ?? '',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SMOKE_MEMBER_PASSWORD is required');
  }, 180_000);

  it('refuses to seed the creator without its own password', async () => {
    const result = runDatabaseScript('reseed-acme.ts', {
      PRODUCTION_DATABASE_FINGERPRINT: databaseHostFingerprint(testDatabaseUrl) ?? '',
      SMOKE_MEMBER_PASSWORD: MEMBER_PASSWORD,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SMOKE_CREATOR_PASSWORD is required');
  }, 180_000);

  it('seeds each smoke account with its own password against the production database', async () => {
    runSucceeds('reseed-acme.ts', {
      PRODUCTION_DATABASE_FINGERPRINT: databaseHostFingerprint(testDatabaseUrl) ?? '',
      SMOKE_MEMBER_PASSWORD: MEMBER_PASSWORD,
      SMOKE_CREATOR_PASSWORD: CREATOR_PASSWORD,
    });

    const memberHash = await credentialHashFor(SMOKE_TENANT_MEMBER_EMAIL);
    const creatorHash = await credentialHashFor(SMOKE_TENANT_CREATOR_EMAIL);
    await expect(verifyPassword({ hash: memberHash, password: MEMBER_PASSWORD })).resolves.toBe(true);
    await expect(verifyPassword({ hash: memberHash, password: DEMO_PASSWORD })).resolves.toBe(false);
    await expect(verifyPassword({ hash: creatorHash, password: CREATOR_PASSWORD })).resolves.toBe(true);
    await expect(verifyPassword({ hash: creatorHash, password: MEMBER_PASSWORD })).resolves.toBe(false);
  }, 180_000);

  it('leaves the purchase account and its fixtures out without a purchase password', async () => {
    const result = runDatabaseScript('reseed-acme.ts');

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).not.toContain(SMOKE_TENANT_PURCHASE_EMAIL);
    expect(await credentialHashFor(SMOKE_TENANT_PURCHASE_EMAIL)).toBe('');
    expect(await purchaseFixtureState()).toEqual({
      roles: [],
      tenant: { shipping_rates: [], terms_url: null, privacy_url: null },
      products: [{ id: 'product-acme-course', type: 'course', delivery_method: 'pickup', price_cents: 9900, vat_rate: null, published: true }],
      prices: [],
      stock: [],
      links: [],
      linkEvents: [],
    });
  }, 180_000);

  it('seeds the purchase account as an admin with its fixtures against the production database', async () => {
    const result = runDatabaseScript('reseed-acme.ts', {
      PRODUCTION_DATABASE_FINGERPRINT: databaseHostFingerprint(testDatabaseUrl) ?? '',
      SMOKE_MEMBER_PASSWORD: MEMBER_PASSWORD,
      SMOKE_CREATOR_PASSWORD: CREATOR_PASSWORD,
      SMOKE_PURCHASE_PASSWORD: PURCHASE_PASSWORD,
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain(SMOKE_TENANT_PURCHASE_EMAIL);
    const purchaseHash = await credentialHashFor(SMOKE_TENANT_PURCHASE_EMAIL);
    await expect(verifyPassword({ hash: purchaseHash, password: PURCHASE_PASSWORD })).resolves.toBe(true);
    await expect(verifyPassword({ hash: purchaseHash, password: DEMO_PASSWORD })).resolves.toBe(false);
    expect(await purchaseFixtureState()).toEqual({
      roles: ['admin'],
      tenant: {
        shipping_rates: [
          { id: 'purchase-e2e-locker', label: 'Purchase test parcel locker', amountCents: 1299, vatRatePercent: 23, carrier: 'inpost', pickupPoint: 'inpost_locker', active: true },
          { id: 'purchase-e2e-courier', label: 'Purchase test courier', amountCents: 1599, vatRatePercent: 23, carrier: 'inpost', pickupPoint: 'none', active: true },
        ],
        terms_url: 'https://togethercommunity.app/terms',
        privacy_url: 'https://togethercommunity.app/privacy',
      },
      products: [
        { id: 'product-acme-course', type: 'course', delivery_method: 'pickup', price_cents: 9900, vat_rate: 23, published: true },
        { id: SMOKE_PURCHASE_PRODUCT.id, type: 'physical', delivery_method: 'shipping', price_cents: 2500, vat_rate: 23, published: true },
      ],
      prices: [{ id: SMOKE_PURCHASE_PRODUCT.priceId, amount_cents: 2500, currency: 'PLN', kind: 'one_time', active: true }],
      stock: [{ on_hand: 1000, reserved: 0 }],
      links: [{
        id: SMOKE_PURCHASE_SALES_LINK.id,
        slug: 'purchase-e2e-bundle',
        product_ids: [SMOKE_PURCHASE_PRODUCT.id, 'product-acme-course'],
        active: true,
        listed: false,
        revision: 1,
      }],
      linkEvents: [{ type: 'created', revision: 1 }],
    });
  }, 180_000);

  it('repeats with the purchase account without adding rows', async () => {
    runSucceeds('reseed-acme.ts', withPurchase);
    const firstCounts = await rowCounts();

    runSucceeds('reseed-acme.ts', withPurchase);

    expect(await rowCounts()).toEqual(firstCounts);
    expect((await purchaseFixtureState()).roles).toEqual(['admin']);
  }, 180_000);

  it('refuses the demo password as the purchase password on the production database', async () => {
    const result = runDatabaseScript('reseed-acme.ts', {
      PRODUCTION_DATABASE_FINGERPRINT: databaseHostFingerprint(testDatabaseUrl) ?? '',
      SMOKE_MEMBER_PASSWORD: MEMBER_PASSWORD,
      SMOKE_CREATOR_PASSWORD: CREATOR_PASSWORD,
      SMOKE_PURCHASE_PASSWORD: DEMO_PASSWORD,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SMOKE_PURCHASE_PASSWORD must not be the shared demo password');
  }, 180_000);

  it('seeds the purchase account under its fixed identity', async () => {
    runSucceeds('reseed-acme.ts', withPurchase);

    expect(await userIdFor(SMOKE_TENANT_PURCHASE_EMAIL)).toBe(SMOKE_TENANT_PURCHASE_USER_ID);
  }, 180_000);

  it('refuses a purchase email that belongs to another identity and grants it nothing', async () => {
    await client.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
       VALUES ('user-someone-else', 'Someone Else', $1, false, NOW(), NOW())`,
      [SMOKE_TENANT_PURCHASE_EMAIL],
    );
    const before = await rowCounts();

    const result = runDatabaseScript('reseed-acme.ts', withPurchase);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('the purchase account email belongs to another identity');
    expect(await credentialHashFor(SMOKE_TENANT_PURCHASE_EMAIL)).toBe('');
    expect(await idsOf(`SELECT id FROM tenant_admins WHERE user_id = 'user-someone-else'`)).toEqual([]);
    expect(await idsOf(`SELECT id FROM "user" WHERE id = '${SMOKE_TENANT_PURCHASE_USER_ID}'`)).toEqual([]);
    expect(await rowCounts()).toEqual(before);
  }, 180_000);

  it('ends every sign-in of the purchase account on a reseed with an unchanged password', async () => {
    const creatorUserId = await seedPurchaseAccountWithSignIns();

    runSucceeds('reseed-acme.ts', withPurchase);

    expect(await signInsOf(SMOKE_TENANT_PURCHASE_USER_ID)).toEqual(reseededPurchaseAccount);
    await expect(verifyPassword({
      hash: await credentialHashFor(SMOKE_TENANT_PURCHASE_EMAIL),
      password: PURCHASE_PASSWORD,
    })).resolves.toBe(true);
    expect((await purchaseFixtureState()).roles).toEqual(['admin']);
    expect(await signInsOf(creatorUserId)).toEqual(untouchedCreatorSignIns);
  }, 180_000);

  it('ends every sign-in and the admin role of the purchase account when the guard refuses', async () => {
    const creatorUserId = await seedPurchaseAccountWithSignIns();
    await addForeignMarketingConsent();

    const result = runDatabaseScript('reseed-acme.ts', withPurchase);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('holds a marketing consent outside @together.dev and the smoke accounts');
    expect(await signInsOf(SMOKE_TENANT_PURCHASE_USER_ID)).toEqual(revokedPurchaseAccount);
    expect(await purchaseSignInStatus()).toBe(401);
    expect((await purchaseFixtureState()).roles).toEqual([]);
    expect(await signInsOf(creatorUserId)).toEqual(untouchedCreatorSignIns);
  }, 180_000);

  it('ends every sign-in and the admin role of the purchase account when its password is unset', async () => {
    const creatorUserId = await seedPurchaseAccountWithSignIns();

    runSucceeds('reseed-acme.ts');

    expect(await signInsOf(SMOKE_TENANT_PURCHASE_USER_ID)).toEqual(revokedPurchaseAccount);
    expect(await purchaseSignInStatus()).toBe(401);
    expect(await idsOf(`SELECT id FROM "user" WHERE id = '${SMOKE_TENANT_PURCHASE_USER_ID}'`))
      .toEqual([SMOKE_TENANT_PURCHASE_USER_ID]);
    expect((await purchaseFixtureState()).roles).toEqual([]);
    expect(await signInsOf(creatorUserId)).toEqual(untouchedCreatorSignIns);
  }, 180_000);

  it('stops the old password at once when only the revocation has committed', async () => {
    runSucceeds('reseed-acme.ts', withPurchase);
    expect(await purchaseSignInStatus()).toBe(200);

    await revokePurchaseAccess(db);

    expect(await purchaseSignInStatus()).toBe(401);
    expect((await purchaseFixtureState()).roles).toEqual([]);
  }, 180_000);

  it('drops a session created between the revocation and the reseed before granting the role', async () => {
    runSucceeds('reseed-acme.ts', withPurchase);
    await revokePurchaseAccess(db);
    await client.query(
      `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id)
       VALUES ('session-between', NOW() + INTERVAL '7 days', 'token-between', NOW(), NOW(), $1)`,
      [SMOKE_TENANT_PURCHASE_USER_ID],
    );

    await reseedSmokeTenant(db, { passwords: purchasePasswords, nowIso: () => new Date().toISOString() });

    expect((await signInsOf(SMOKE_TENANT_PURCHASE_USER_ID)).sessions).toEqual([]);
    expect((await purchaseFixtureState()).roles).toEqual(['admin']);
  }, 180_000);

  it('refuses when another identity holds the purchase account id and leaves its rows intact', async () => {
    await client.query(
      `INSERT INTO "user" (id, name, email, email_verified, two_factor_enabled, created_at, updated_at)
       VALUES ($1, 'Someone Else', 'someone@example.com', true, false, NOW(), NOW())`,
      [SMOKE_TENANT_PURCHASE_USER_ID],
    );
    await client.query(
      `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
       VALUES ('account-someone-credential', $1, 'credential', $1, 'hash', NOW(), NOW())`,
      [SMOKE_TENANT_PURCHASE_USER_ID],
    );
    await grantSignIns(SMOKE_TENANT_PURCHASE_USER_ID, 'someone');
    await issueResetToken(SMOKE_TENANT_PURCHASE_USER_ID, 'someone-reset');
    const signInsBefore = await signInsOf(SMOKE_TENANT_PURCHASE_USER_ID);
    const before = await rowCounts();

    for (const overrides of [withPurchase, {}]) {
      const result = runDatabaseScript('reseed-acme.ts', overrides);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('the purchase account id belongs to another identity');
    }
    expect(await signInsOf(SMOKE_TENANT_PURCHASE_USER_ID)).toEqual(signInsBefore);
    expect(await idsOf(`SELECT email AS id FROM "user" WHERE id = '${SMOKE_TENANT_PURCHASE_USER_ID}'`))
      .toEqual(['someone@example.com']);
    expect(await rowCounts()).toEqual(before);
  }, 180_000);

  it('leaves a grant that carries the purchase grant id but belongs to another user', async () => {
    await client.query(
      `INSERT INTO tenant_admins (id, tenant_id, user_id, role)
       VALUES ('admin-acme-purchase', 'tenant-acme', 'user-other-admin', 'admin')`,
    );

    await revokePurchaseAccess(db);

    expect(await idsOf(`SELECT user_id AS id FROM tenant_admins WHERE id = 'admin-acme-purchase'`))
      .toEqual(['user-other-admin']);
  }, 180_000);

  it('voids a password reset issued for the purchase account before the reseed', async () => {
    runSucceeds('reseed-acme.ts', withPurchase);
    const creatorUserId = await userIdFor(SMOKE_TENANT_CREATOR_EMAIL);
    await issueResetToken(SMOKE_TENANT_PURCHASE_USER_ID, 'purchase-reset');
    await issueResetToken(creatorUserId, 'creator-reset');

    runSucceeds('reseed-acme.ts', withPurchase);

    expect(await resetPasswordStatus('purchase-reset', 'attacker-password-15')).toBe(400);
    await expect(verifyPassword({
      hash: await credentialHashFor(SMOKE_TENANT_PURCHASE_EMAIL),
      password: PURCHASE_PASSWORD,
    })).resolves.toBe(true);
    expect(await resetPasswordStatus('creator-reset', 'creator-new-password-15')).toBe(200);
  }, 180_000);

  it('voids a magic link issued for the purchase account before the reseed', async () => {
    runSucceeds('reseed-acme.ts', withPurchase);
    const purchaseToken = await issueMagicLink(SMOKE_TENANT_PURCHASE_EMAIL.toUpperCase());
    const creatorToken = await issueMagicLink(SMOKE_TENANT_CREATOR_EMAIL);
    expect(new Set(await magicLinkIdentifiers())).toEqual(
      new Set([`magic-link:${purchaseToken}`, `magic-link:${creatorToken}`]),
    );
    expect(purchaseToken).not.toBe(creatorToken);

    runSucceeds('reseed-acme.ts', withPurchase);

    const verification = new URL(AUTH_MAGIC_LINK_VERIFICATION_PATH, AUTH_ORIGIN);
    verification.search = new URLSearchParams({ token: purchaseToken, callbackURL: `${AUTH_ORIGIN}/` }).toString();
    const verified = await authHandler()(new Request(verification));
    expect(verified.headers.get('location')).toContain('error=INVALID_TOKEN');
    expect((await signInsOf(SMOKE_TENANT_PURCHASE_USER_ID)).sessions).toEqual([]);
    expect(await magicLinkIdentifiers()).toEqual([`magic-link:${creatorToken}`]);
  }, 180_000);
});
