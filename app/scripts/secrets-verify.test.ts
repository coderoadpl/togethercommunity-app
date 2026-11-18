import { describe, expect, it } from 'vitest';

import { secretFingerprint } from '#adapters/crypto/secret-fingerprint.js';
import { REDACTED_OPERATOR_SECRET } from '#core/client/index.js';
import { API_PATHS, SCHEDULER_OPERATOR_SECRET_HEADER, type SecretFingerprint } from '#core/contract/index.js';

import { compareSecretFingerprints, formatVerdict, runSecretsVerify, verificationPassed } from './secrets-verify.js';

const local = {
  BETTER_AUTH_SECRET: 'test-only-better-auth-secret',
  CRON_SECRET: '  test-only-cron-secret\n',
  MARKETING_TICK_SECRET: 'test-only-marketing-local',
  EMAIL_DISPATCH_SECRET: 'test-only-dispatch-secret',
  SECRETS_MASTER_KEY: 'test-only-master-key',
  PROD_OPERATOR_SECRET: 'test-only-operator-secret',
};

const set = (name: string, value: string): SecretFingerprint => ({ name, set: true, fingerprint: secretFingerprint(name, value) });
const unset = (name: string): SecretFingerprint => ({ name, set: false, fingerprint: null });

const server: SecretFingerprint[] = [
  set('BETTER_AUTH_SECRET', local.BETTER_AUTH_SECRET),
  set('CRON_SECRET', 'test-only-cron-secret'),
  set('MARKETING_TICK_SECRET', 'test-only-marketing-server'),
  set('EMAIL_DISPATCH_SECRET', `${local.EMAIL_DISPATCH_SECRET}\n`),
  unset('SECRETS_MASTER_KEY'),
  set('SMTP_PASSWORD', 'test-only-smtp-password'),
  set('PROD_OPERATOR_SECRET', local.PROD_OPERATOR_SECRET),
];

describe('compareSecretFingerprints', () => {
  it('reports every outcome, including a whitespace difference on either side', () => {
    expect(compareSecretFingerprints(server, local)).toEqual([
      { name: 'BETTER_AUTH_SECRET', outcome: 'MATCH' },
      { name: 'CRON_SECRET', outcome: 'MISMATCH', trimmedMatches: true, serverAddsLineBreak: false },
      { name: 'MARKETING_TICK_SECRET', outcome: 'MISMATCH', trimmedMatches: false, serverAddsLineBreak: false },
      { name: 'EMAIL_DISPATCH_SECRET', outcome: 'MISMATCH', trimmedMatches: false, serverAddsLineBreak: true },
      { name: 'SECRETS_MASTER_KEY', outcome: 'NOT SET ON SERVER' },
      { name: 'SMTP_PASSWORD', outcome: 'NOT IN LOCAL ENV' },
      { name: 'PROD_OPERATOR_SECRET', outcome: 'MATCH' },
    ]);
  });

  it('recognises a server value that carries a CRLF line break after the local value', () => {
    expect(compareSecretFingerprints([set('CRON_SECRET', 'test-only-cron-secret\r\n')], { CRON_SECRET: 'test-only-cron-secret' }))
      .toEqual([{ name: 'CRON_SECRET', outcome: 'MISMATCH', trimmedMatches: false, serverAddsLineBreak: true }]);
  });

  it('treats an empty local value as absent', () => {
    expect(compareSecretFingerprints([unset('SMTP_PASSWORD')], { SMTP_PASSWORD: '' }))
      .toEqual([{ name: 'SMTP_PASSWORD', outcome: 'NOT IN LOCAL ENV' }]);
  });
});

describe('verificationPassed', () => {
  it('passes only when every locally present name matches', () => {
    expect(verificationPassed([{ name: 'A', outcome: 'MATCH' }, { name: 'B', outcome: 'NOT IN LOCAL ENV' }])).toBe(true);
    expect(verificationPassed([{ name: 'A', outcome: 'MATCH' }, { name: 'B', outcome: 'NOT SET ON SERVER' }])).toBe(false);
    expect(verificationPassed([{ name: 'A', outcome: 'MISMATCH', trimmedMatches: true, serverAddsLineBreak: false }])).toBe(false);
    expect(verificationPassed([{ name: 'A', outcome: 'NOT IN LOCAL ENV' }])).toBe(false);
  });
});

describe('formatVerdict', () => {
  it('names the whitespace hint of a mismatch', () => {
    expect(formatVerdict({ name: 'CRON_SECRET', outcome: 'MATCH' })).toBe('MATCH             CRON_SECRET');
    expect(formatVerdict({ name: 'CRON_SECRET', outcome: 'MISMATCH', trimmedMatches: true, serverAddsLineBreak: false }))
      .toBe('MISMATCH          CRON_SECRET  trimmed local value matches (whitespace difference)');
    expect(formatVerdict({ name: 'CRON_SECRET', outcome: 'MISMATCH', trimmedMatches: false, serverAddsLineBreak: false }))
      .toBe('MISMATCH          CRON_SECRET  trimmed local value does not match either');
    expect(formatVerdict({ name: 'CRON_SECRET', outcome: 'MISMATCH', trimmedMatches: false, serverAddsLineBreak: true }))
      .toContain('the server value is the local value followed by a line break');
  });
});

const fakeServer = (secrets: SecretFingerprint[], expectedSecret: string) => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), headers });
    return headers.get(SCHEDULER_OPERATOR_SECRET_HEADER) === expectedSecret
      ? Response.json({ ok: true, data: { secrets } })
      : Response.json({ ok: false, error: { code: 'unauthorized', message: 'Invalid operator secret' } }, { status: 401 });
  };
  return { calls, fetchImpl };
};

const verify = async (argv: string[], env: Record<string, string>, fetchImpl: typeof fetch) => {
  const lines: string[] = [];
  const code = await runSecretsVerify({ argv, env, fetchImpl, write: (line) => { lines.push(line); } });
  return { code, output: lines.join('\n') };
};

describe('runSecretsVerify', () => {
  it('authenticates with the only operator secret present, prints one line per name and never a value', async () => {
    const { calls, fetchImpl } = fakeServer(server, local.PROD_OPERATOR_SECRET);
    const { code, output } = await verify(['--', '--base-url', 'https://platform.example.test/ignored'], local, fetchImpl);
    expect(code).toBe(1);
    expect(calls).toEqual([expect.objectContaining({ url: `https://platform.example.test${API_PATHS.secretFingerprints}` })]);
    expect(output.split('\n')).toHaveLength(server.length + 1);
    expect(output).toContain('NOT SET ON SERVER SECRETS_MASTER_KEY');
    expect(output).toContain('NOT IN LOCAL ENV  SMTP_PASSWORD');
    expect(output).toContain('secrets:verify: FAIL (2 of 7 matched)');
    for (const value of [...Object.values(local), 'test-only']) expect(output).not.toContain(value.trim());
  });

  const allOperatorSecrets = {
    OPERATOR_SECRET: 'test-only-preferred-operator',
    PROD_OPERATOR_SECRET: 'test-only-prod-operator',
    STAGING_OPERATOR_SECRET: 'test-only-staging-operator',
    BETTER_AUTH_SECRET: local.BETTER_AUTH_SECRET,
  };
  const passingSecrets = [set('BETTER_AUTH_SECRET', local.BETTER_AUTH_SECRET), unset('SMTP_PASSWORD')];

  it.each([
    { env: allOperatorSecrets, present: 'OPERATOR_SECRET, PROD_OPERATOR_SECRET, STAGING_OPERATOR_SECRET' },
    {
      env: { PROD_OPERATOR_SECRET: allOperatorSecrets.PROD_OPERATOR_SECRET, STAGING_OPERATOR_SECRET: allOperatorSecrets.STAGING_OPERATOR_SECRET },
      present: 'PROD_OPERATOR_SECRET, STAGING_OPERATOR_SECRET',
    },
  ])('refuses to choose between $present before any request', async ({ env, present }) => {
    const { calls, fetchImpl } = fakeServer(passingSecrets, allOperatorSecrets.PROD_OPERATOR_SECRET);
    const { code, output } = await verify(['--base-url', 'https://staging.example.test'], env, fetchImpl);
    expect(code).toBe(2);
    expect(calls).toEqual([]);
    expect(output).toBe(`secrets:verify: ${present} are all set; choose the one the target host accepts with --auth-with <NAME>`);
    for (const value of Object.values(env)) expect(output).not.toContain(value);
  });

  it.each(['OPERATOR_SECRET', 'PROD_OPERATOR_SECRET', 'STAGING_OPERATOR_SECRET'] as const)(
    'authenticates with the --auth-with %s choice only and exits 0 when every present name matches',
    async (name) => {
      const { calls, fetchImpl } = fakeServer(passingSecrets, allOperatorSecrets[name]);
      const { code, output } = await verify(['--base-url', 'http://localhost:48730', '--auth-with', name], allOperatorSecrets, fetchImpl);
      expect(code).toBe(0);
      expect(calls.map((call) => call.headers.get(SCHEDULER_OPERATOR_SECRET_HEADER))).toEqual([allOperatorSecrets[name]]);
      expect(output).toContain('secrets:verify: PASS (1 of 2 matched)');
    },
  );

  it.each([
    { authWith: 'STAGING_OPERATOR_SECRET', message: '--auth-with STAGING_OPERATOR_SECRET is not set in the local environment' },
    { authWith: 'CRON_SECRET', message: '--auth-with must be one of OPERATOR_SECRET, PROD_OPERATOR_SECRET, STAGING_OPERATOR_SECRET' },
  ])('refuses --auth-with $authWith before any request', async ({ authWith, message }) => {
    const { calls, fetchImpl } = fakeServer(server, local.PROD_OPERATOR_SECRET);
    const { code, output } = await verify(['--base-url', 'https://platform.example.test', '--auth-with', authWith], local, fetchImpl);
    expect(code).toBe(2);
    expect(calls).toEqual([]);
    expect(output).toBe(`secrets:verify: ${message}`);
  });

  it('reports the operator rejection without echoing the secret', async () => {
    const { fetchImpl } = fakeServer(server, 'test-only-other-operator');
    const { code, output } = await verify(['--base-url', 'https://platform.example.test'], local, fetchImpl);
    expect(code).toBe(1);
    expect(output).toBe('secrets:verify: FAIL unauthorized: Invalid operator secret');
  });

  it('replaces the sent operator secret in a server error that reflects it', async () => {
    const reflecting: typeof fetch = async (_url, init) => {
      const sent = new Headers(init?.headers).get(SCHEDULER_OPERATOR_SECRET_HEADER) ?? '';
      return Response.json({ ok: false, error: { code: 'unauthorized', message: `Rejected ${sent}`, details: { sent } } }, { status: 401 });
    };
    const { code, output } = await verify(['--base-url', 'https://platform.example.test'], local, reflecting);
    expect(code).toBe(1);
    expect(output).toBe(`secrets:verify: FAIL unauthorized: Rejected ${REDACTED_OPERATOR_SECRET}`);
    expect(output).not.toContain(local.PROD_OPERATOR_SECRET);
  });

  const baseUrlRefusal = '--base-url must be an https URL, or http on a local host';

  it.each([
    { argv: [], message: baseUrlRefusal },
    { argv: ['--base-url', 'http://platform.example.test'], message: baseUrlRefusal },
    { argv: ['--base-url', 'not a url'], message: baseUrlRefusal },
    { argv: ['--base-url', 'https://platform.example.test', '--unknown'], message: "Unknown option '--unknown'" },
    {
      argv: ['--base-url', 'http://127.0.0.1:9', '--auth-with'],
      message: "Option '--auth-with <value>' argument missing",
    },
  ])('refuses $argv before sending the operator secret', async ({ argv, message }) => {
    const { calls, fetchImpl } = fakeServer(server, local.PROD_OPERATOR_SECRET);
    const { code, output } = await verify(argv, local, fetchImpl);
    expect(code).toBe(2);
    expect(output).toBe(`usage: pnpm --silent run secrets:verify -- --base-url <https://host> [--auth-with <NAME>]\nsecrets:verify: ${message}`);
    expect(calls).toEqual([]);
  });

  it('refuses to run without an operator secret', async () => {
    const { calls, fetchImpl } = fakeServer(server, local.PROD_OPERATOR_SECRET);
    const { code, output } = await verify(['--base-url', 'https://platform.example.test'], { CRON_SECRET: 'test-only-cron' }, fetchImpl);
    expect(code).toBe(2);
    expect(output).toContain('one of OPERATOR_SECRET, PROD_OPERATOR_SECRET, STAGING_OPERATOR_SECRET is required');
    expect(calls).toEqual([]);
  });
});
