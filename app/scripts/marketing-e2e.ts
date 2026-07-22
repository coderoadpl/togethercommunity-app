import { createSign } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { z } from 'zod';

import { createAuthE2eClient } from '@adapters/auth/e2e-http.js';
import { TENANT_HEADER } from '@core/contract/index.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = join(rootDir, 'node_modules/.bin/tsx');
const verifyContainer = 'together-marketing-verify-pg';
const verifyPort = 49219;
const verifyDatabaseUrl = `postgres://together:together@localhost:${verifyPort}/together`;
const tenantSlug = 'marketing-verify';
const tickSecret = 'marketing-e2e-tick-secret';
const topicArn = 'arn:aws:sns:eu-central-1:123456789012:marketing-e2e';
const legalName = 'Marketing Verify sp. z o.o.';
const legalAddress = 'ul. Testowa 1, 00-001 Warszawa';
const consentLabel = 'Chcę otrzymywać wiadomości o nowych materiałach';
const emails = {
  confirmedA: 'confirmed-a@marketing.test',
  confirmedB: 'confirmed-b@marketing.test',
  suppressed: 'suppressed@marketing.test',
  pending: 'pending@marketing.test',
  unsubscribe: 'unsubscribe@marketing.test',
  confirmation: 'confirmation@marketing.test',
};

class MarketingE2eFailure extends Error {}

const assert: (condition: boolean, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new MarketingE2eFailure(message);
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<Run> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: rootDir, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (cause) => resolve({ code: 1, stdout, stderr: `${stderr}${String(cause)}` }));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });

const ephemeralPort = (): Promise<number> => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, () => {
    const address = probe.address();
    if (address === null || typeof address === 'string') {
      probe.close(() => reject(new MarketingE2eFailure('Could not allocate an ephemeral port')));
      return;
    }
    probe.close(() => resolve(address.port));
  });
});

const startPostgres = async (): Promise<void> => {
  await run('docker', ['rm', '-f', verifyContainer]);
  const result = await run('docker', [
    'run', '--rm', '-d', '--name', verifyContainer,
    '-e', 'POSTGRES_USER=together', '-e', 'POSTGRES_PASSWORD=together', '-e', 'POSTGRES_DB=together',
    '-p', `${verifyPort}:5432`, 'postgres:16',
  ]);
  assert(result.code === 0, `Could not start verification Postgres.\n${result.stdout}${result.stderr}`);
};

const stopPostgres = async (): Promise<void> => {
  await run('docker', ['rm', '-f', verifyContainer]);
};

const waitForPostgres = async (): Promise<void> => {
  const deadline = Date.now() + 30_000;
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
  throw new MarketingE2eFailure(`Verification Postgres did not become ready.\n${lastError}`);
};

const migrate = async (): Promise<void> => {
  const result = await run(tsxBin, ['adapters/db/migrate.ts'], { DATABASE_URL: verifyDatabaseUrl });
  assert(result.code === 0, `Migration failed:\n${result.stdout}${result.stderr}`);
};

const generateCertificate = async (directory: string): Promise<{ certificate: string; privateKey: string }> => {
  const certificatePath = join(directory, 'sns-cert.pem');
  const privateKeyPath = join(directory, 'sns-key.pem');
  const result = await run('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=sns.eu-central-1.amazonaws.com', '-keyout', privateKeyPath, '-out', certificatePath,
  ]);
  assert(result.code === 0, `Could not generate the local SNS certificate.\n${result.stderr}`);
  return {
    certificate: readFileSync(certificatePath, 'utf8'),
    privateKey: readFileSync(privateKeyPath, 'utf8'),
  };
};

const bootServer = async (port: number, webDistDir: string, certificate: string): Promise<ChildProcess> => {
  const child = spawn(tsxBin, ['apps/server/src/entry.node.ts'], {
    cwd: rootDir,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: verifyDatabaseUrl,
      APP_BASE_URL: `http://${tenantSlug}.localhost:${port}`,
      APP_BASE_DOMAIN: 'localhost',
      WEB_DIST_DIR: webDistDir,
      SIMULATED_PAYMENTS: 'true',
      AUTH_DEV_EXPOSE_MAGIC_LINKS: 'true',
      EMAIL_DISPATCH_INTERVAL_MS: '100',
      EMAIL_DISPATCH_RATE_PER_SECOND: '50',
      MARKETING_TICK_SECRET: tickSecret,
      SNS_TEST_CERT_PEM_BASE64: Buffer.from(certificate).toString('base64'),
    },
  });
  let logs = '';
  let exitInfo: string | null = null;
  child.stdout?.on('data', (chunk) => { logs += String(chunk); });
  child.stderr?.on('data', (chunk) => { logs += String(chunk); });
  child.on('exit', (code, signal) => { exitInfo = `code=${String(code)} signal=${String(signal)}`; });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (exitInfo !== null) throw new MarketingE2eFailure(`Server exited before ready (${exitInfo}).\n${logs}`);
    try {
      const response = await fetch(`http://localhost:${port}/api/health`);
      if (response.ok) return child;
    } catch {
    }
    await delay(250);
  }
  throw new MarketingE2eFailure(`Server did not become ready.\n${logs}`);
};

const killServer = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const signal = (value: NodeJS.Signals): void => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, value);
    } catch {
      child.kill(value);
    }
  };
  signal('SIGTERM');
  await Promise.race([exited, delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) signal('SIGKILL');
};

const envelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }) }),
]);

const request = async (
  baseUrl: string,
  path: string,
  init: RequestInit,
  expectedStatus: number,
): Promise<{ response: Response; data: unknown }> => {
  const response = await fetch(`${baseUrl}${path}`, init);
  const raw = await response.text();
  assert(response.status === expectedStatus, `${init.method ?? 'GET'} ${path}: expected ${expectedStatus}, got ${response.status}.\n${raw}`);
  if (raw === '') return { response, data: null };
  const envelope = envelopeSchema.parse(JSON.parse(raw));
  if (!envelope.ok) throw new MarketingE2eFailure(`${init.method ?? 'GET'} ${path}: ${envelope.error.code}: ${envelope.error.message}`);
  return { response, data: envelope.data };
};

const staffHeaders = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  [TENANT_HEADER]: tenantSlug,
  'content-type': 'application/json',
});

const apiHeaders = (apiKey: string): Record<string, string> => ({
  'x-api-key': apiKey,
  [TENANT_HEADER]: tenantSlug,
  'content-type': 'application/json',
});

const jsonPost = (headers: Record<string, string>, body: unknown): RequestInit => ({
  method: 'POST', headers, body: JSON.stringify(body),
});

const waitUntil = async (label: string, condition: () => Promise<boolean>): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await delay(100);
  }
  throw new MarketingE2eFailure(`${label}: timed out`);
};

const countSchema = z.object({ count: z.coerce.number().int() });
const idSchema = z.object({ id: z.string() });
const consentRowsSchema = z.array(z.object({ id: z.string(), email: z.string(), status: z.string(), previous_id: z.string().nullable() }));
const sendRowsSchema = z.array(z.object({
  id: z.string(), email: z.string(), status: z.string(), skip_reason: z.string().nullable(),
  consent_row_id: z.string(), ses_message_id: z.string().nullable(), delivery_status: z.string().nullable(),
}));
const campaignRowSchema = z.object({ status: z.string(), to_send: z.number().int(), sent: z.number().int(), failed: z.number().int() });
const capturedEmailSchema = z.object({
  to: z.string(), subject: z.string(), html: z.string(), text: z.string(),
  headers: z.record(z.string()), message_id: z.string().nullable(), created_at: z.string(),
});

const queryCount = async (db: pg.Client, sql: string, values: unknown[] = []): Promise<number> =>
  countSchema.parse((await db.query(sql, values)).rows[0]).count;

const currentConsents = async (db: pg.Client, tenantId: string, email?: string) => consentRowsSchema.parse((await db.query(
  `select id, email, status, previous_id from marketing_consents where tenant_id = $1${email === undefined ? '' : ' and email = $2'} order by occurred_at, id`,
  email === undefined ? [tenantId] : [tenantId, email],
)).rows);

const campaignSends = async (db: pg.Client, tenantId: string, campaignId: string) => sendRowsSchema.parse((await db.query(
  'select id, email, status, skip_reason, consent_row_id, ses_message_id, delivery_status from campaign_sends where tenant_id = $1 and campaign_id = $2 order by created_at, id',
  [tenantId, campaignId],
)).rows);

const scheduleAndTick = async (
  baseUrl: string,
  staffToken: string,
  tenantId: string,
  campaignId: string,
  db: pg.Client,
): Promise<void> => {
  await request(baseUrl, '/api/marketing/campaigns/schedule', jsonPost(staffHeaders(staffToken), {
    campaignId,
    sendAt: new Date(Date.now() + 60_000).toISOString(),
  }), 200);
  await db.query('update campaigns set send_at = $1 where tenant_id = $2 and id = $3', [new Date(Date.now() - 1000).toISOString(), tenantId, campaignId]);
  await request(baseUrl, '/api/internal/marketing/tick', jsonPost({
    'content-type': 'application/json',
    'x-marketing-tick-secret': tickSecret,
  }, { tenantId, campaignId }), 200);
  await waitUntil(`campaign ${campaignId}`, async () => {
    const row = campaignRowSchema.parse((await db.query(
      'select status, to_send, sent, failed from campaigns where tenant_id = $1 and id = $2',
      [tenantId, campaignId],
    )).rows[0]);
    return row.status === 'finished';
  });
};

const createCampaign = async (
  baseUrl: string,
  staffToken: string,
  definitionId: string,
  name: string,
): Promise<string> => {
  const created = await request(baseUrl, '/api/marketing/campaigns', jsonPost(staffHeaders(staffToken), {
    name,
    subject: `${name} subject`,
    bodyHtml: `<h1>${name}</h1><p>Hello {{member.name ?? reader}}</p>`,
    consentDefinitionId: definitionId,
    productIds: [],
    layoutId: null,
  }), 200);
  return z.object({ campaign: idSchema }).parse(created.data).campaign.id;
};

const canonicalSnsInput = (envelope: {
  Message: string;
  MessageId: string;
  Timestamp: string;
  TopicArn: string;
  Type: 'Notification';
}): string => [
  `Message\n${envelope.Message}\n`,
  `MessageId\n${envelope.MessageId}\n`,
  `Timestamp\n${envelope.Timestamp}\n`,
  `TopicArn\n${envelope.TopicArn}\n`,
  `Type\n${envelope.Type}\n`,
].join('');

const signedSnsEnvelope = (privateKey: string, arn: string, message: unknown): string => {
  const envelope = {
    Type: 'Notification' as const,
    MessageId: `sns-${crypto.randomUUID()}`,
    TopicArn: arn,
    Message: JSON.stringify(message),
    Timestamp: new Date().toISOString(),
  };
  const signer = createSign('RSA-SHA256');
  signer.update(canonicalSnsInput(envelope));
  signer.end();
  return JSON.stringify({
    ...envelope,
    SignatureVersion: '2',
    Signature: signer.sign(privateKey, 'base64'),
    SigningCertURL: 'https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-test.pem',
  });
};

const sesMessage = (kind: 'hard' | 'soft' | 'complaint', messageId: string): unknown => {
  const timestamp = new Date().toISOString();
  if (kind === 'complaint') return { notificationType: 'Complaint', mail: { messageId, timestamp }, complaint: { timestamp } };
  return {
    notificationType: 'Bounce',
    mail: { messageId, timestamp },
    bounce: {
      bounceType: kind === 'hard' ? 'Permanent' : 'Transient',
      timestamp,
      bouncedRecipients: [{ status: kind === 'hard' ? '5.1.1' : '4.2.2' }],
    },
  };
};

const postSns = async (baseUrl: string, webhookToken: string, body: string): Promise<void> => {
  await request(baseUrl, `/api/webhooks/ses/${webhookToken}`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'x-amz-sns-message-type': 'Notification' },
    body,
  }, 200);
};

const driveScenario = async (port: number, privateKey: string): Promise<number> => {
  const platformBaseUrl = `http://localhost:${port}`;
  const baseUrl = `http://${tenantSlug}.localhost:${port}`;
  const db = new pg.Client({ connectionString: verifyDatabaseUrl });
  await db.connect();
  let steps = 0;
  try {
    const auth = createAuthE2eClient({ connectUrl: platformBaseUrl, origin: baseUrl });
    const signUp = await auth.signUpEmail({ name: 'Marketing Owner', email: 'owner@marketing.test', password: 'Demo1234!' });
    assert(signUp.status < 400 && signUp.token !== null, `Owner registration failed: ${JSON.stringify(signUp.json)}`);
    const staffToken = signUp.token;
    const tenantResponse = await request(platformBaseUrl, '/api/tenants', jsonPost({
      authorization: `Bearer ${staffToken}`,
      'content-type': 'application/json',
    }, { slug: tenantSlug, name: 'Marketing Verify' }), 200);
    const tenant = z.object({ tenant: z.object({ id: z.string() }) }).parse(tenantResponse.data).tenant;
    const apiKeyResponse = await request(baseUrl, '/api/api-keys', jsonPost(staffHeaders(staffToken), { name: 'Marketing E2E' }), 200);
    const apiKey = z.object({ secret: z.string() }).parse(apiKeyResponse.data).secret;
    steps += 1;
    console.log('  1. tenant and API key created');

    const definitionResponse = await request(baseUrl, '/api/marketing/consent-definitions', jsonPost(staffHeaders(staffToken), {
      key: 'newsletter',
      label: consentLabel,
      doubleOptIn: true,
      documentRef: { mode: 'url', url: 'https://marketing.test/privacy' },
    }), 200);
    const definitionId = z.object({ definition: idSchema }).parse(definitionResponse.data).definition.id;
    for (const [key, value] of Object.entries({
      'ses.accessKeyId': 'test-access',
      'ses.secretAccessKey': 'test-secret',
      'ses.region': 'eu-central-1',
    })) {
      await request(baseUrl, '/api/tenant-secrets', jsonPost(staffHeaders(staffToken), { key, value }), 200);
    }
    const settingsResponse = await request(baseUrl, '/api/marketing/ses-settings', jsonPost(staffHeaders(staffToken), {
      fromAddress: 'newsletter@marketing.test',
      fromName: 'Marketing Verify',
      identity: 'marketing.test',
      identityVerified: true,
      configurationSet: 'marketing-e2e',
      snsTopicArn: topicArn,
      footerLegalName: legalName,
      footerAddress: legalAddress,
    }), 200);
    const settings = z.object({ settings: z.object({ webhookToken: z.string() }) }).parse(settingsResponse.data).settings;
    await db.query(
      'update tenant_ses_settings set webhook_verified_at = now(), quota_rate_per_sec = 50, quota_daily = 1000, in_sandbox = false where tenant_id = $1',
      [tenant.id],
    );
    const memberEntries = Object.entries(emails);
    for (let index = 0; index < memberEntries.length; index += 1) {
      const entry = memberEntries[index];
      assert(entry !== undefined, 'Member fixture entry is missing');
      await db.query(
        'insert into members (id, tenant_id, user_id, email, display_name, created_at) values ($1, $2, $3, $4, $5, $6)',
        [`member-${String(index + 1).padStart(2, '0')}`, tenant.id, `marketing-user-${index + 1}`, entry[1], entry[0], new Date().toISOString()],
      );
    }
    steps += 1;
    console.log('  2. DOI definition, SES readiness, and member fixtures created');

    const memberIdByEmail = new Map<string, string>();
    const memberRows = z.array(z.object({ id: z.string(), email: z.string() })).parse((await db.query(
      'select id, email from members where tenant_id = $1', [tenant.id],
    )).rows);
    for (const member of memberRows) memberIdByEmail.set(member.email, member.id);
    const grant = async (email: string, proofRef: string): Promise<string> => {
      const memberId = memberIdByEmail.get(email);
      assert(memberId !== undefined, `Missing member fixture for ${email}`);
      const recorded = await request(baseUrl, '/api/m2m/marketing/consents', jsonPost(apiHeaders(apiKey), {
        email,
        memberId,
        definitionId,
        collectedAt: new Date().toISOString(),
        source: 'api',
        proofRef,
      }), 201);
      z.object({ consent: idSchema, state: z.literal('pending_confirmation') }).parse(recorded.data);
      await waitUntil(`confirmation mail for ${email}`, async () => queryCount(db, 'select count(*) from dev_emails where "to" = $1', [email]).then((count) => count === 1));
      const captured = capturedEmailSchema.parse((await db.query('select * from dev_emails where "to" = $1', [email])).rows[0]);
      assert(Object.keys(captured.headers).length === 0, `DOI mail for ${email} must not contain marketing headers`);
      const match = captured.html.match(/href="([^"]*\/marketing\/confirm\/[^\"]+)"/);
      assert(match?.[1] !== undefined, `DOI mail for ${email} has no confirmation link`);
      return match[1];
    };
    const confirmationA = await grant(emails.confirmedA, 'signup-a');
    const confirmationB = await grant(emails.confirmedB, 'signup-b');
    await grant(emails.suppressed, 'signup-suppressed');
    await grant(emails.pending, 'signup-pending');
    for (const link of [confirmationA, confirmationB]) {
      const confirmation = new URL(link);
      const response = await fetch(`${baseUrl}${confirmation.pathname}`, {
        method: 'POST',
        headers: { [TENANT_HEADER]: tenantSlug },
      });
      assert(response.status === 200, `DOI confirmation failed with HTTP ${response.status}`);
    }
    await request(baseUrl, '/api/m2m/marketing/suppressions', jsonPost(apiHeaders(apiKey), {
      email: emails.suppressed,
      reason: 'manual',
      sourceRef: 'e1-fixture',
    }), 201);
    steps += 1;
    console.log('  3. four DOI states prepared and confirmation mail verified');

    const broadcastId = await createCampaign(baseUrl, staffToken, definitionId, 'E1 broadcast');
    await scheduleAndTick(baseUrl, staffToken, tenant.id, broadcastId, db);
    const broadcast = campaignRowSchema.parse((await db.query(
      'select status, to_send, sent, failed from campaigns where id = $1', [broadcastId],
    )).rows[0]);
    assert(broadcast.status === 'finished' && broadcast.to_send === 4 && broadcast.sent === 2 && broadcast.failed === 0,
      `E1 counters mismatch: ${JSON.stringify(broadcast)}`);
    const broadcastRows = await campaignSends(db, tenant.id, broadcastId);
    assert(broadcastRows.length === 4, `E1 expected 4 send-log rows, got ${broadcastRows.length}`);
    assert(broadcastRows.filter((row) => row.status === 'sent').length === 2, 'E1 must send exactly two messages');
    assert(await queryCount(db, 'select count(*) from dev_emails where subject = $1', ['E1 broadcast subject']) === 2, 'E1 sink must capture exactly two broadcast messages');
    assert(broadcastRows.find((row) => row.email === emails.suppressed)?.skip_reason === 'suppressed', 'E1 suppressed reason missing');
    assert(broadcastRows.find((row) => row.email === emails.pending)?.skip_reason === 'pending_confirmation', 'E1 pending reason missing');
    for (const email of [emails.confirmedA, emails.confirmedB]) {
      const captured = capturedEmailSchema.parse((await db.query('select * from dev_emails where "to" = $1', [email])).rows[0]);
      assert(captured.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', `${email}: RFC 8058 POST header missing`);
      assert(new RegExp(`^<http://${tenantSlug}\\.localhost:\\d+/u/[A-Za-z0-9_-]+>$`).test(captured.headers['List-Unsubscribe'] ?? ''), `${email}: unsubscribe header invalid`);
      assert(captured.headers['Precedence'] === 'bulk', `${email}: Precedence header missing`);
      assert(captured.headers['Auto-Submitted'] === 'auto-generated', `${email}: Auto-Submitted header missing`);
      assert(captured.headers['X-Auto-Response-Suppress'] === 'All', `${email}: auto-response header missing`);
      assert(captured.html.includes(legalName) && captured.html.includes(legalAddress) && captured.html.includes(consentLabel), `${email}: mandatory footer missing`);
      const unsubscribeUrl = captured.headers['List-Unsubscribe']?.slice(1, -1);
      assert(unsubscribeUrl !== undefined, `${email}: unsubscribe URL missing`);
      const page = await fetch(unsubscribeUrl);
      const pageHtml = await page.text();
      assert(page.status === 200 && pageHtml.includes('marketing-preferences'), `${email}: unsubscribe URL does not render: ${pageHtml.slice(0, 500)}`);
      const row = broadcastRows.find((candidate) => candidate.email === email);
      const latest = (await currentConsents(db, tenant.id, email)).at(-1);
      assert(row !== undefined && latest !== undefined, `${email}: send log or confirming consent missing`);
      assert(row.consent_row_id === latest.id && latest.status === 'confirmed', `${email}: send log does not reference confirming consent`);
      assert(row.ses_message_id === captured.message_id, `${email}: sink/provider MessageId mismatch`);
    }
    steps += 1;
    console.log('  4. E1 broadcast recipients, headers, footer, tokens, counters, and evidence verified');

    const eligibilitySchema = z.object({ eligible: z.boolean(), reasons: z.array(z.string()) });
    const eligible = eligibilitySchema.parse((await request(baseUrl,
      `/api/m2m/marketing/eligibility?email=${encodeURIComponent(emails.confirmedA)}&definitionId=${definitionId}`,
      { headers: apiHeaders(apiKey) }, 200)).data);
    const pending = eligibilitySchema.parse((await request(baseUrl,
      `/api/m2m/marketing/eligibility?email=${encodeURIComponent(emails.pending)}&definitionId=${definitionId}`,
      { headers: apiHeaders(apiKey) }, 200)).data);
    assert(eligible.eligible && eligible.reasons.length === 0, 'E2 confirmed member must be eligible');
    assert(!pending.eligible && pending.reasons[0] === 'pending_confirmation', 'E2 pending member reason mismatch');
    const dripBody = {
      to: emails.confirmedA,
      consentDefinitionId: definitionId,
      subject: 'Drip day 0',
      bodyHtml: '<p>Welcome {{member.email}}</p>',
      data: {},
      campaignKey: 'e2-drip',
    };
    const dayZeroHeaders = { ...apiHeaders(apiKey), 'Idempotency-Key': 'e2-day-0' };
    const dayZero = z.object({ results: z.array(z.object({ sendId: z.string(), status: z.string() })) }).parse(
      (await request(baseUrl, '/api/m2m/marketing/messages', jsonPost(dayZeroHeaders, dripBody), 202)).data,
    );
    const conflictResponse = await fetch(`${baseUrl}/api/m2m/marketing/messages`, jsonPost(dayZeroHeaders, dripBody));
    const conflictRaw: unknown = await conflictResponse.json();
    const conflict = envelopeSchema.parse(conflictRaw);
    assert(conflictResponse.status === 409 && !conflict.ok && conflict.error.code === 'conflict', 'E2 identical retry must return conflict');
    const conflictDetails = z.object({ requestMethod: z.literal('POST'), requestPath: z.literal('/api/m2m/marketing/messages'), requestHash: z.string(), claimedAt: z.string() }).parse(conflict.error.details);
    assert(conflictDetails.requestHash.length === 64, 'E2 conflict must return original request metadata');
    const dayThree = z.object({ results: z.array(z.object({ sendId: z.string(), status: z.string() })) }).parse((await request(
      baseUrl,
      '/api/m2m/marketing/messages',
      jsonPost({ ...apiHeaders(apiKey), 'Idempotency-Key': 'e2-day-3' }, { ...dripBody, subject: 'Drip day 3' }),
      202,
    )).data);
    const batch = z.object({ results: z.array(z.object({
      to: z.string(), sendId: z.string().nullable(), status: z.string(), reason: z.string().optional(),
    })) }).parse((await request(baseUrl, '/api/m2m/marketing/messages', jsonPost(apiHeaders(apiKey), { messages: [
      { ...dripBody, to: emails.confirmedB, campaignKey: 'e2-batch', subject: 'Batch eligible' },
      { ...dripBody, to: emails.suppressed, campaignKey: 'e2-batch', subject: 'Batch suppressed' },
    ] }), 202)).data);
    assert(batch.results.find((item) => item.to === emails.confirmedB)?.status === 'queued', 'E2 eligible batch item must queue');
    assert(batch.results.find((item) => item.to === emails.suppressed)?.reason === 'suppressed', 'E2 suppressed batch reason mismatch');
    const listed = z.object({ sends: z.array(z.object({ id: z.string(), status: z.string() })) }).parse((await request(
      baseUrl, '/api/m2m/marketing/messages?campaignKey=e2-drip', { headers: apiHeaders(apiKey) }, 200,
    )).data);
    assert(listed.sends.length === 2 && listed.sends.every((item) => item.status === 'sent'), 'E2 drip list must expose both sent steps');
    const shown = z.object({ id: z.string(), status: z.literal('sent') }).parse((await request(
      baseUrl, `/api/m2m/marketing/messages/${dayZero.results[0]?.sendId ?? ''}`, { headers: apiHeaders(apiKey) }, 200,
    )).data);
    assert(shown.id === dayZero.results[0]?.sendId && dayThree.results[0]?.status === 'queued', 'E2 message show or day-3 send failed');
    steps += 1;
    console.log('  5. E2 eligibility, idempotency, multi-step drip, list/show, and mixed batch verified');

    const hardSendId = dayZero.results[0]?.sendId;
    const softSendId = dayThree.results[0]?.sendId;
    const complaintSendId = batch.results.find((item) => item.to === emails.confirmedB)?.sendId;
    assert(hardSendId !== undefined && softSendId !== undefined && complaintSendId !== undefined && complaintSendId !== null, 'E3 send fixtures missing');
    const providerRows = sendRowsSchema.parse((await db.query(
      'select id, email, status, skip_reason, consent_row_id, ses_message_id, delivery_status from campaign_sends where id = any($1::text[])',
      [[hardSendId, softSendId, complaintSendId]],
    )).rows);
    const messageIdFor = (sendId: string): string => {
      const messageId = providerRows.find((row) => row.id === sendId)?.ses_message_id;
      assert(messageId !== null && messageId !== undefined, `Missing provider MessageId for ${sendId}`);
      return messageId;
    };
    await postSns(baseUrl, settings.webhookToken, signedSnsEnvelope(privateKey, topicArn, sesMessage('hard', messageIdFor(hardSendId))));
    await postSns(baseUrl, settings.webhookToken, signedSnsEnvelope(privateKey, topicArn, sesMessage('complaint', messageIdFor(complaintSendId))));
    await postSns(baseUrl, settings.webhookToken, signedSnsEnvelope(privateKey, topicArn, sesMessage('soft', messageIdFor(softSendId))));
    const updatedDelivery = sendRowsSchema.parse((await db.query(
      'select id, email, status, skip_reason, consent_row_id, ses_message_id, delivery_status from campaign_sends where id = any($1::text[])',
      [[hardSendId, softSendId, complaintSendId]],
    )).rows);
    assert(updatedDelivery.find((row) => row.id === hardSendId)?.delivery_status === 'bounced', 'E3 hard bounce status missing');
    assert(updatedDelivery.find((row) => row.id === complaintSendId)?.delivery_status === 'complained', 'E3 complaint status missing');
    assert(updatedDelivery.find((row) => row.id === softSendId)?.delivery_status === 'bounced', 'E3 soft bounce status missing');
    assert(await queryCount(db, "select count(*) from suppressions where tenant_id = $1 and reason = 'hard_bounce' and source_ref = $2", [tenant.id, hardSendId]) === 1, 'E3 hard-bounce suppression missing');
    assert(await queryCount(db, "select count(*) from suppressions where tenant_id = $1 and reason = 'complaint' and source_ref = $2", [tenant.id, complaintSendId]) === 1, 'E3 complaint suppression missing');
    assert(await queryCount(db, 'select count(*) from suppressions where tenant_id = $1 and source_ref = $2', [tenant.id, softSendId]) === 0, 'E3 soft bounce must not suppress');
    const beforeMismatch = await queryCount(db, 'select count(*) from suppressions where tenant_id = $1', [tenant.id]);
    await postSns(baseUrl, settings.webhookToken, signedSnsEnvelope(privateKey, `${topicArn}-wrong`, sesMessage('hard', messageIdFor(softSendId))));
    assert(await queryCount(db, 'select count(*) from suppressions where tenant_id = $1', [tenant.id]) === beforeMismatch, 'E3 TopicArn mismatch changed state');
    const followUpId = await createCampaign(baseUrl, staffToken, definitionId, 'E3 follow-up');
    await scheduleAndTick(baseUrl, staffToken, tenant.id, followUpId, db);
    const followUpRows = await campaignSends(db, tenant.id, followUpId);
    const followUpSuppressed = followUpRows.filter((row) => row.skip_reason === 'suppressed').map((row) => row.email).sort();
    const expectedSuppressed = [emails.confirmedA, emails.confirmedB, emails.suppressed].sort();
    assert(JSON.stringify(followUpSuppressed) === JSON.stringify(expectedSuppressed), 'E3 follow-up must log the exact suppressed recipients');
    steps += 1;
    console.log('  6. E3 locally signed SNS events, correlation, suppression, mismatch isolation, and follow-up skips verified');

    const unsubscribeConfirmation = await grant(emails.unsubscribe, 'unsubscribe-journey');
    const unsubscribeConfirmPath = new URL(unsubscribeConfirmation).pathname;
    assert((await fetch(`${baseUrl}${unsubscribeConfirmPath}`, { method: 'POST', headers: { [TENANT_HEADER]: tenantSlug } })).status === 200, 'E4 unsubscribe fixture confirmation failed');
    const unsubscribeSend = z.object({ results: z.array(z.object({ sendId: z.string() })) }).parse((await request(
      baseUrl, '/api/m2m/marketing/messages', jsonPost(apiHeaders(apiKey), {
        to: emails.unsubscribe,
        consentDefinitionId: definitionId,
        subject: 'Preference journey',
        bodyHtml: '<p>Preferences</p>',
        data: {},
        campaignKey: 'e4-preferences',
      }), 202,
    )).data);
    const tokenRow = z.object({ token: z.string(), id: z.string() }).parse((await db.query(
      'select token, id from unsubscribe_tokens where campaign_send_id = $1', [unsubscribeSend.results[0]?.sendId],
    )).rows[0]);
    const stateBeforeGet = {
      consents: await queryCount(db, 'select count(*) from marketing_consents where tenant_id = $1 and email = $2', [tenant.id, emails.unsubscribe]),
      suppressions: await queryCount(db, 'select count(*) from suppressions where tenant_id = $1 and email = $2', [tenant.id, emails.unsubscribe]),
      used: await queryCount(db, 'select count(*) from unsubscribe_tokens where id = $1 and used_at is not null', [tokenRow.id]),
    };
    const preferences = await fetch(`${baseUrl}/u/${tokenRow.token}`, { headers: { [TENANT_HEADER]: tenantSlug } });
    assert(preferences.status === 200 && (await preferences.text()).includes('marketing-preferences'), 'E4 GET preference page failed');
    const stateAfterGet = {
      consents: await queryCount(db, 'select count(*) from marketing_consents where tenant_id = $1 and email = $2', [tenant.id, emails.unsubscribe]),
      suppressions: await queryCount(db, 'select count(*) from suppressions where tenant_id = $1 and email = $2', [tenant.id, emails.unsubscribe]),
      used: await queryCount(db, 'select count(*) from unsubscribe_tokens where id = $1 and used_at is not null', [tokenRow.id]),
    };
    assert(JSON.stringify(stateBeforeGet) === JSON.stringify(stateAfterGet), 'E4 GET mutated preference state');
    const oneClick = (): Promise<Response> => fetch(`${baseUrl}/u/${tokenRow.token}`, {
      method: 'POST',
      headers: { [TENANT_HEADER]: tenantSlug, 'content-type': 'application/x-www-form-urlencoded' },
    });
    assert((await oneClick()).status === 200 && (await oneClick()).status === 200, 'E4 one-click POST must be idempotent');
    assert((await currentConsents(db, tenant.id, emails.unsubscribe)).at(-1)?.status === 'withdrawn', 'E4 withdrawal row missing');
    const unsubscribedCampaignId = await createCampaign(baseUrl, staffToken, definitionId, 'E4 unsubscribed');
    await scheduleAndTick(baseUrl, staffToken, tenant.id, unsubscribedCampaignId, db);
    assert((await campaignSends(db, tenant.id, unsubscribedCampaignId)).find((row) => row.email === emails.unsubscribe)?.skip_reason === 'unsubscribed', 'E4 campaign unsubscribe reason missing');
    const refused = z.object({ results: z.array(z.object({ status: z.string(), reason: z.string() })) }).parse((await request(
      baseUrl, '/api/m2m/marketing/messages', jsonPost(apiHeaders(apiKey), {
        to: emails.unsubscribe,
        consentDefinitionId: definitionId,
        subject: 'Must skip',
        bodyHtml: '<p>Skip</p>',
        data: {},
      }), 202,
    )).data);
    assert(refused.results[0]?.status === 'skipped' && refused.results[0]?.reason === 'unsubscribed', 'E4 API unsubscribe reason mismatch');
    const allToken = `all-${crypto.randomUUID().replaceAll('-', '')}`;
    await db.query(
      "insert into unsubscribe_tokens (id, tenant_id, token, email, member_id, campaign_send_id, scope, created_at) values ($1, $2, $3, $4, $5, null, 'all_marketing', now())",
      [`all-id-${crypto.randomUUID()}`, tenant.id, allToken, emails.unsubscribe, memberIdByEmail.get(emails.unsubscribe)],
    );
    const globalPost = (): Promise<Response> => fetch(`${baseUrl}/u/${allToken}`, {
      method: 'POST', headers: { [TENANT_HEADER]: tenantSlug, 'content-type': 'application/x-www-form-urlencoded' },
    });
    assert((await globalPost()).status === 200 && (await globalPost()).status === 200, 'E4 global one-click must be idempotent');
    assert(await queryCount(db, "select count(*) from suppressions where tenant_id = $1 and email = $2 and reason = 'unsubscribe_global'", [tenant.id, emails.unsubscribe]) === 1, 'E4 global suppression missing');
    steps += 1;
    console.log('  7. E4 GET safety, one-click idempotency, withdrawal/global suppression, and send refusal verified');

    const freshConfirmation = await grant(emails.confirmation, 'confirmation-regression');
    const freshPath = new URL(freshConfirmation).pathname;
    const beforeInterstitial = (await currentConsents(db, tenant.id, emails.confirmation)).length;
    const interstitial = await fetch(`${baseUrl}${freshPath}`, { headers: { [TENANT_HEADER]: tenantSlug } });
    assert(interstitial.status === 200 && (await interstitial.text()).includes('marketing-confirmation-prompt'), 'E4 confirmation GET must render interstitial');
    assert((await currentConsents(db, tenant.id, emails.confirmation)).length === beforeInterstitial, 'E4 confirmation GET mutated consent');
    const confirmed = await fetch(`${baseUrl}${freshPath}`, { method: 'POST', headers: { [TENANT_HEADER]: tenantSlug } });
    assert(confirmed.status === 200 && (await confirmed.text()).includes('marketing-confirmation-success'), 'E4 confirmation POST failed');
    assert((await currentConsents(db, tenant.id, emails.confirmation)).at(-1)?.status === 'confirmed', 'E4 confirmation POST did not append confirmed consent');
    steps += 1;
    console.log('  8. E4 DOI GET interstitial and POST confirmation regression verified');

    return steps;
  } finally {
    await db.end().catch(() => undefined);
  }
};

const startedAt = Date.now();
const temporaryDirectories: string[] = [];
let server: ChildProcess | null = null;
let postgresStarted = false;

try {
  console.log('marketing-e2e: starting fresh verification Postgres...');
  await startPostgres();
  postgresStarted = true;
  await waitForPostgres();
  console.log('marketing-e2e: running migrations...');
  await migrate();
  const runtimeDir = mkdtempSync(join(tmpdir(), 'marketing-e2e-'));
  const webDistDir = mkdtempSync(join(tmpdir(), 'marketing-e2e-web-'));
  temporaryDirectories.push(runtimeDir, webDistDir);
  const certificate = await generateCertificate(runtimeDir);
  const port = await ephemeralPort();
  console.log(`marketing-e2e: booting server on port ${port}...`);
  server = await bootServer(port, webDistDir, certificate.certificate);
  console.log('marketing-e2e: driving E1-E4...');
  const steps = await driveScenario(port, certificate.privateKey);
  console.log(`\nmarketing-e2e: PASS (${steps} steps, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof MarketingE2eFailure ? error.message : error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`\nmarketing-e2e: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server !== null) await killServer(server);
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
  if (postgresStarted) await stopPostgres();
}
