import { spawn, spawnSync } from 'node:child_process';
import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  type KeyObject,
} from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { z } from 'zod';

import { createContentHash } from '#adapters/crypto/content-hash.js';
import { createKsefCredentialResolver } from '#adapters/crypto/ksef-credential-resolver.js';
import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import { createInvoiceRepository } from '#adapters/db/invoice-repositories.js';
import { uniqueTestDatabaseName } from '#adapters/db/test-database-name.js';
import {
  createFiscalArtifactRepository,
  createKsefNumberRepository,
  createKsefSubmissionJobRepository,
} from '#adapters/db/ksef-repositories.js';
import {
  createOrderRepository,
  createTenantRepository,
  createTenantSecretRepository,
} from '#adapters/db/repositories.js';
import * as schema from '#adapters/db/schema.js';
import { createFakeInvoicing } from '#adapters/invoicing/fake.js';
import { createFa3XsdValidator } from '#adapters/invoicing/fa3-validator.js';
import { createKsefClient } from '#adapters/invoicing/ksef.js';
import { dispatchKsefJob, requestInvoice } from '#core/server/index.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = join(rootDir, 'node_modules/.bin/tsx');
const apiBaseUrl = 'https://api-test.ksef.mf.gov.pl/v2';
const databaseName = uniqueTestDatabaseName('together_ksef_e2e');
const authNamespace = 'http://ksef.mf.gov.pl/auth/token/2.1';
const signatureNamespace = 'http://www.w3.org/2000/09/xmldsig#';
const xadesNamespace = 'http://uri.etsi.org/01903/v1.3.2#';
const sha256Algorithm = 'http://www.w3.org/2001/04/xmlenc#sha256';

const tokenInfoSchema = z.object({ token: z.string(), validUntil: z.string() });
const challengeSchema = z.object({ challenge: z.string(), timestampMs: z.number() });
const authInitSchema = z.object({
  referenceNumber: z.string(),
  authenticationToken: tokenInfoSchema,
});
const authStatusSchema = z.object({
  status: z.object({ code: z.number(), description: z.string() }),
});
const redeemedSchema = z.object({
  accessToken: tokenInfoSchema,
  refreshToken: tokenInfoSchema,
});
const generatedTokenSchema = z.object({
  referenceNumber: z.string(),
  token: z.string(),
});
const generatedTokenStatusSchema = z.object({
  status: z.enum(['Pending', 'Active', 'Revoking', 'Revoked', 'Failed']),
  statusDetails: z.array(z.string()).default([]),
});
const invoiceRowSchema = z.object({
  id: z.string(),
  order_id: z.string(),
  status: z.string(),
  invoice_number: z.string(),
  ksef: z.object({
    state: z.string(),
    ksefNumber: z.string(),
    upoArtifactKey: z.string(),
  }),
});
const eventRowsSchema = z.array(z.object({ type: z.string() }));
const artifactRowsSchema = z.array(z.object({
  kind: z.enum(['fa3', 'upo']),
  content: z.string(),
  sha256: z.string(),
}));

class E2eFailure extends Error {}

const assert: (condition: boolean, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new E2eFailure(message);
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const generateNip = (): string => {
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  while (true) {
    const digits = [8, ...Array.from(randomBytes(8), (value) => value % 10)];
    const checksum = digits.reduce(
      (sum, digit, index) => sum + digit * (weights[index] ?? 0),
      0,
    ) % 11;
    if (checksum < 10) {
      const nip = `${digits.join('')}${String(checksum)}`;
      if (/^[1-9]((\d[1-9])|([1-9]\d))\d{7}$/u.test(nip)) return nip;
    }
  }
};

const xmlEscape = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const digestBase64 = (content: string | Uint8Array): string =>
  createHash('sha256').update(content).digest('base64');

const createTestCertificate = (
  nip: string,
): { certificate: Buffer; privateKey: KeyObject } => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const generated = spawnSync(
    'openssl',
    [
      'req', '-x509', '-new', '-key', '/dev/stdin', '-sha256', '-days', '2', '-outform', 'DER',
      '-subj',
      `/2.5.4.42=Together/2.5.4.4=E2E/serialNumber=TINPL-${nip}/CN=Together KSeF E2E/C=PL`,
    ],
    { input: privateKey.export({ type: 'pkcs8', format: 'pem' }), maxBuffer: 1_000_000 },
  );
  if (generated.status !== 0) {
    throw new E2eFailure(`openssl could not create the KSeF TEST certificate: ${String(generated.stderr)}`);
  }
  return { certificate: generated.stdout, privateKey };
};

const signedAuthRequest = (challenge: string, nip: string): string => {
  const { certificate, privateKey } = createTestCertificate(nip);
  const signatureId = `id-${randomBytes(8).toString('hex')}`;
  const propertiesId = `xades-${signatureId}`;
  const payload =
    `<AuthTokenRequest xmlns="${authNamespace}">` +
    `<Challenge>${xmlEscape(challenge)}</Challenge>` +
    `<ContextIdentifier><Nip>${nip}</Nip></ContextIdentifier>` +
    `<SubjectIdentifierType>certificateSubject</SubjectIdentifierType>`;
  const signingTime = new Date().toISOString();
  // Inclusive c14n renders every in-scope namespace on the signed apex element, so each signed
  // fragment is digested with the declarations its ancestors carry in the emitted document.
  const signedProperties = (inScopeNamespaces: string): string =>
    `<xades:SignedProperties${inScopeNamespaces} Id="${propertiesId}">` +
    '<xades:SignedSignatureProperties>' +
    `<xades:SigningTime>${signingTime}</xades:SigningTime>` +
    '<xades:SigningCertificateV2><xades:Cert><xades:CertDigest>' +
    `<ds:DigestMethod Algorithm="${sha256Algorithm}"></ds:DigestMethod>` +
    `<ds:DigestValue>${digestBase64(certificate)}</ds:DigestValue>` +
    '</xades:CertDigest></xades:Cert></xades:SigningCertificateV2>' +
    '</xades:SignedSignatureProperties></xades:SignedProperties>';
  const emittedProperties = signedProperties('');
  const signedInfo = (inScopeNamespaces: string): string =>
    `<ds:SignedInfo${inScopeNamespaces}>` +
    '<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></ds:CanonicalizationMethod>' +
    '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></ds:SignatureMethod>' +
    '<ds:Reference URI=""><ds:Transforms>' +
    '<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></ds:Transform>' +
    `</ds:Transforms><ds:DigestMethod Algorithm="${sha256Algorithm}"></ds:DigestMethod>` +
    `<ds:DigestValue>${digestBase64(`${payload}</AuthTokenRequest>`)}</ds:DigestValue></ds:Reference>` +
    `<ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#${propertiesId}">` +
    `<ds:DigestMethod Algorithm="${sha256Algorithm}"></ds:DigestMethod>` +
    `<ds:DigestValue>${digestBase64(signedProperties(
      ` xmlns="${authNamespace}" xmlns:ds="${signatureNamespace}" xmlns:xades="${xadesNamespace}"`,
    ))}</ds:DigestValue>` +
    '</ds:Reference></ds:SignedInfo>';
  const signature = createSign('RSA-SHA256')
    .update(signedInfo(` xmlns="${authNamespace}" xmlns:ds="${signatureNamespace}"`))
    .sign(privateKey)
    .toString('base64');
  return `<?xml version="1.0" encoding="UTF-8"?>${payload}` +
    `<ds:Signature xmlns:ds="${signatureNamespace}" Id="${signatureId}">${signedInfo('')}` +
    `<ds:SignatureValue>${signature}</ds:SignatureValue>` +
    `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certificate.toString('base64')}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>` +
    `<ds:Object><xades:QualifyingProperties xmlns:xades="${xadesNamespace}" Target="#${signatureId}">` +
    `${emittedProperties}</xades:QualifyingProperties></ds:Object></ds:Signature></AuthTokenRequest>`;
};

const request = async (
  path: string,
  init: RequestInit = {},
): Promise<Response> => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const headers = new Headers(init.headers);
    headers.set('X-Error-Format', 'problem-details');
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 429 || attempt === 3) {
      if (!response.ok) {
        throw new E2eFailure(
          `${init.method ?? 'GET'} ${path} returned ${String(response.status)}: ${await response.text()}`,
        );
      }
      return response;
    }
    const retryAfter = Number(response.headers.get('retry-after') ?? '1');
    await sleep(Math.max(1, retryAfter) * 1000);
  }
  throw new E2eFailure(`KSeF rate-limit retries exhausted for ${path}`);
};

const bearer = (token: string): HeadersInit => ({ authorization: `Bearer ${token}` });

const pollAuth = async (
  referenceNumber: string,
  authenticationToken: string,
): Promise<void> => {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const response = await request(`/auth/${encodeURIComponent(referenceNumber)}`, {
      headers: bearer(authenticationToken),
    });
    const status = authStatusSchema.parse(await response.json()).status;
    if (status.code === 200) return;
    if (status.code !== 100) throw new E2eFailure(`KSeF XAdES authentication failed: ${status.description}`);
    await sleep(1000);
  }
  throw new E2eFailure('KSeF XAdES authentication timed out');
};

const mintTestToken = async (
  sellerNip: string,
): Promise<{ accessToken: string; ksefToken: string; tokenReference: string }> => {
  const challenge = challengeSchema.parse(await (await request('/auth/challenge', {
    method: 'POST',
  })).json());
  const xml = signedAuthRequest(challenge.challenge, sellerNip);
  const initialized = authInitSchema.parse(await (await request(
    '/auth/xades-signature?verifyCertificateChain=false',
    {
      method: 'POST',
      headers: { 'content-type': 'application/xml; charset=utf-8' },
      body: xml,
    },
  )).json());
  await pollAuth(initialized.referenceNumber, initialized.authenticationToken.token);
  const redeemed = redeemedSchema.parse(await (await request('/auth/token/redeem', {
    method: 'POST',
    headers: bearer(initialized.authenticationToken.token),
  })).json());
  const generated = generatedTokenSchema.parse(await (await request('/tokens', {
    method: 'POST',
    headers: {
      ...bearer(redeemed.accessToken.token),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      permissions: ['InvoiceWrite'],
      description: `Together E2E ${new Date().toISOString()}`,
    }),
  })).json());
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const status = generatedTokenStatusSchema.parse(await (await request(
      `/tokens/${encodeURIComponent(generated.referenceNumber)}`,
      { headers: bearer(redeemed.accessToken.token) },
    )).json());
    if (status.status === 'Active') {
      return {
        accessToken: redeemed.accessToken.token,
        ksefToken: generated.token,
        tokenReference: generated.referenceNumber,
      };
    }
    if (status.status === 'Failed' || status.status === 'Revoked') {
      throw new E2eFailure(`KSeF token activation failed: ${status.statusDetails.join(', ')}`);
    }
    await sleep(1000);
  }
  throw new E2eFailure('KSeF token activation timed out');
};

const run = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new E2eFailure(`${command} ${args.join(' ')} failed:\n${output}`));
    });
  });

const prepareDatabase = async (
  baseDatabaseUrl: string,
): Promise<{ databaseUrl: string; adminUrl: string }> => {
  const admin = new URL(baseDatabaseUrl);
  admin.pathname = '/postgres';
  const database = new URL(baseDatabaseUrl);
  database.pathname = `/${databaseName}`;
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await client.end();
  }
  await run(tsxBin, ['adapters/db/migrate.ts'], { DATABASE_URL: database.toString() });
  await run(tsxBin, ['adapters/db/seed.ts'], { DATABASE_URL: database.toString() });
  return { databaseUrl: database.toString(), adminUrl: admin.toString() };
};

const dropDatabase = async (adminUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  } finally {
    await client.end();
  }
};

const executeAdapterE2e = async (
  databaseUrl: string,
  sellerNip: string,
  buyerNip: string,
  ksefToken: string,
) => {
  const raw = new pg.Client({ connectionString: databaseUrl });
  raw.on('error', () => undefined);
  await raw.connect();
  const tenantId = 'tenant-acme';
  const orderId = `order-ksef-e2e-${randomBytes(4).toString('hex')}`;
  const now = new Date();
  const year = now.getUTCFullYear();
  const sequence = 100000 + (now.getTime() % 800000);
  const exempt = process.env.KSEF_E2E_VAT_MODE === 'exempt';
  await raw.query(
    `insert into orders
       (id, tenant_id, member_id, product_id, price_id, kind, status, amount_cents,
        currency, provider, provider_object_ids, coupon_id, discount_cents, billing, created_at)
     values ($1, $2, 'member-acme-student2', 'product-acme-course', null, 'one_time',
       'paid', 12300, 'PLN', 'simulated', '{}'::jsonb, null, 0, $3::jsonb, $4)`,
    [orderId, tenantId, JSON.stringify({
      nip: buyerNip,
      companyName: 'Together KSeF E2E Buyer',
      address: 'Testowa 2',
      postalCode: '00-002',
      city: 'Warszawa',
      country: 'PL',
    }), now.toISOString()],
  );
  await raw.query(
    `update tenants
     set invoicing_provider = 'ksef',
         invoice_vat_mode = $2,
         invoice_vat_rate_percent = $3,
         invoice_exemption_basis_kind = $4,
         invoice_exemption_basis = $5,
         invoice_seller_name = 'Together KSeF E2E Seller',
         invoice_seller_address = 'Testowa 1, 00-001 Warszawa'
     where id = $1`,
    [
      tenantId,
      exempt ? 'exempt' : 'rate',
      exempt ? null : 23,
      exempt ? 'art_113_1' : null,
      exempt ? 'art. 113 ust. 1 ustawy o podatku od towarów i usług' : null,
    ],
  );
  await raw.query(
    `insert into ksef_number_sequences
       (id, tenant_id, invoice_type, year, next_value, updated_at)
     values ($1, $2, 'VAT', $3, $4, $5)
     on conflict (tenant_id, invoice_type, year)
     do update set next_value = excluded.next_value, updated_at = excluded.updated_at`,
    [`${tenantId}:VAT:${String(year)}`, tenantId, year, sequence, now.toISOString()],
  );

  const pool = new pg.Pool({ connectionString: databaseUrl });
  pool.on('error', () => undefined);
  const db = drizzle(pool, { schema });
  const invoices = createInvoiceRepository(db);
  const orders = createOrderRepository(db);
  const tenants = createTenantRepository(db);
  const tenantSecrets = createTenantSecretRepository(db);
  const secretCrypto = createSecretCrypto(randomBytes(32).toString('base64'));
  for (const [key, value] of [
    ['ksef.token', ksefToken],
    ['ksef.contextNip', sellerNip],
  ] as const) {
    const encrypted = secretCrypto.encrypt(value);
    await tenantSecrets.upsert(tenantId, {
      id: randomUUID(),
      tenantId,
      key,
      ...encrypted,
      maskedPreview: `••••${value.slice(-4)}`,
      updatedAt: now.toISOString(),
    });
  }
  const resolver = createTenantSecretResolver(tenantSecrets, secretCrypto);
  const credentials = createKsefCredentialResolver(resolver);
  const artifacts = createFiscalArtifactRepository(db);
  const hash = createContentHash();
  const client = createKsefClient({
    baseUrls: {
      test: apiBaseUrl,
      production: 'https://api.ksef.mf.gov.pl/v2',
    },
  });
  const ids = { nextId: randomUUID };
  const clock = { nowIso: () => new Date().toISOString() };
  const ksef = {
    environment: 'test' as const,
    credentials,
    numbers: createKsefNumberRepository(db),
    artifacts,
    hash,
    validator: createFa3XsdValidator(),
    client,
  };
  const requested = await requestInvoice(
    {
      identity: {
        userId: 'e2e-owner',
        email: 'e2e@together.dev',
        name: 'E2E',
        emailVerified: true,
        tenantId,
        tenantSlug: 'acme',
        tenantName: 'Acme',
        staffRole: 'owner',
        memberId: null,
        image: null,
        memberDisplayName: null,
        memberBannedAt: null,
        memberDmOptOutAt: null,
      },
    },
    orderId,
    {
      invoices,
      invoicing: createFakeInvoicing(),
      orderDetails: orders,
      tenants,
      tenantSecrets,
      secretCrypto,
      ids,
      clock,
      ksef,
    },
  );
  assert(requested.ok, `Invoice freeze failed: ${requested.ok ? '' : requested.error.message}`);
  const invoiceId = requested.value.id;
  const jobs = createKsefSubmissionJobRepository(db);
  const dispatchDeps = {
    invoices,
    artifacts,
    credentials,
    ksef: client,
    hash,
    ids,
    clock,
    retry: { baseMs: 1000, capMs: 10_000, jitter: () => 0 },
    jobs,
  };
  let completed = requested.value;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const dispatched = await dispatchKsefJob(dispatchDeps);
    assert(dispatched.ok, `KSeF dispatch failed: ${dispatched.ok ? '' : dispatched.error.message}`);
    completed = (await invoices.findById(tenantId, invoiceId)) ?? completed;
    if (completed.ksef?.state === 'succeeded') break;
    if (completed.ksef?.state === 'rejected' || completed.ksef?.state === 'numbering_conflict') {
      throw new E2eFailure(
        `KSeF reached ${completed.ksef.state}: ${completed.ksef.lastStatusDescription ?? completed.error ?? ''}`,
      );
    }
    await sleep(1000);
  }
  assert(completed.ksef?.state === 'succeeded', 'KSeF invoice did not reach succeeded');
  assert(completed.ksef.ksefNumber !== null, 'KSeF number was not persisted');
  assert(completed.ksef.upoArtifactKey !== null, 'UPO artifact key was not persisted');

  const invoiceRows = z.array(invoiceRowSchema).parse((await raw.query(
    `select id, order_id, status, invoice_number, ksef from invoices where tenant_id = $1 and id = $2`,
    [tenantId, invoiceId],
  )).rows);
  const eventRows = eventRowsSchema.parse((await raw.query(
    `select type from invoice_events where tenant_id = $1 and invoice_id = $2 order by occurred_at, id`,
    [tenantId, invoiceId],
  )).rows);
  const artifactRows = artifactRowsSchema.parse((await raw.query(
    `select kind, content, sha256 from fiscal_artifacts where tenant_id = $1 and invoice_id = $2 order by kind`,
    [tenantId, invoiceId],
  )).rows);
  assert(invoiceRows.length === 1, 'Expected one invoice lifecycle projection');
  const eventTypes = new Set(eventRows.map((event) => event.type));
  for (const required of ['frozen', 'session_opened', 'send_started', 'submitted', 'upo_stored']) {
    assert(
      eventTypes.has(required),
      `Missing invoice lifecycle event ${required}; observed ${[...eventTypes].join(', ')}`,
    );
  }
  assert(artifactRows.map((artifact) => artifact.kind).join(',') === 'fa3,upo', 'Expected FA(3) and UPO artifacts');
  const fa3 = artifactRows.find((artifact) => artifact.kind === 'fa3');
  const upo = artifactRows.find((artifact) => artifact.kind === 'upo');
  assert(fa3 !== undefined && fa3.content.includes(`<NIP>${buyerNip}</NIP>`), 'Frozen FA(3) did not use the seeded order buyer');
  assert(fa3.content.includes(`<P_2>${completed.ksef.p2}</P_2>`), 'Frozen FA(3) did not use the allocated P_2');
  assert(
    exempt ? fa3.content.includes('<P_12>zw</P_12>') : fa3.content.includes('<P_12>23</P_12>'),
    'Frozen FA(3) did not use the selected VAT treatment',
  );
  assert(upo !== undefined && upo.content.includes(completed.ksef.ksefNumber), 'Stored UPO does not identify the issued invoice');
  assert(hash.sha256(upo.content) === upo.sha256, 'Stored UPO hash is invalid');
  if (completed.ksef.sessionReference !== null) {
    const resolved = await credentials.resolve(tenantId);
    assert(resolved.ok, 'KSeF credentials could not be resolved for session cleanup');
    const closed = await client.closeSession({
      environment: 'test',
      credentials: resolved.value,
      sessionReference: completed.ksef.sessionReference,
    });
    assert(closed.ok, `KSeF session cleanup failed: ${closed.ok ? '' : closed.error.message}`);
  }
  await raw.end();
  await pool.end();
  return {
    invoiceId,
    invoiceNumber: completed.ksef.p2,
    ksefNumber: completed.ksef.ksefNumber,
    upoSha256: completed.ksef.upoSha256,
    lifecycleEvents: eventRows.map((event) => event.type),
  };
};

const main = async (): Promise<void> => {
  try {
    await fetch(`${apiBaseUrl}/auth/challenge`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
  } catch (cause) {
    process.stdout.write(`SKIP: KSeF TEST environment is unreachable (${String(cause)})\n`);
    return;
  }
  const sellerNip = generateNip();
  let buyerNip = generateNip();
  while (buyerNip === sellerNip) buyerNip = generateNip();
  const minted = await mintTestToken(sellerNip);
  const baseDatabaseUrl =
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
  const prepared = await prepareDatabase(baseDatabaseUrl);
  try {
    const result = await executeAdapterE2e(
      prepared.databaseUrl,
      sellerNip,
      buyerNip,
      minted.ksefToken,
    );
    process.stdout.write(`PASS: ${JSON.stringify({ sellerNip, buyerNip, ...result })}\n`);
  } finally {
    await request(`/tokens/${encodeURIComponent(minted.tokenReference)}`, {
      method: 'DELETE',
      headers: bearer(minted.accessToken),
    });
    await dropDatabase(prepared.adminUrl);
  }
};

await main();
