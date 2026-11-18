import { describe, expect, it } from 'vitest';

import { secretFingerprint } from '#adapters/crypto/secret-fingerprint.js';
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
  it('falls back to PROD_OPERATOR_SECRET, prints one line per name and never a value', async () => {
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

  it('exits 0 when every locally present name matches and prefers OPERATOR_SECRET over the deprecated names', async () => {
    const env = {
      OPERATOR_SECRET: 'test-only-preferred-operator',
      PROD_OPERATOR_SECRET: 'test-only-prod-operator',
      STAGING_OPERATOR_SECRET: 'test-only-staging-operator',
      BETTER_AUTH_SECRET: local.BETTER_AUTH_SECRET,
    };
    const { fetchImpl } = fakeServer([set('BETTER_AUTH_SECRET', local.BETTER_AUTH_SECRET), unset('SMTP_PASSWORD')], env.OPERATOR_SECRET);
    const { code, output } = await verify(['--base-url', 'http://localhost:48730'], env, fetchImpl);
    expect(code).toBe(0);
    expect(output).toContain('secrets:verify: PASS (1 of 2 matched)');
  });

  it('prefers PROD_OPERATOR_SECRET over STAGING_OPERATOR_SECRET, then falls back to STAGING_OPERATOR_SECRET', async () => {
    const secrets = [set('BETTER_AUTH_SECRET', local.BETTER_AUTH_SECRET)];
    const stagingOnly = { STAGING_OPERATOR_SECRET: 'test-only-staging-operator', BETTER_AUTH_SECRET: local.BETTER_AUTH_SECRET };
    const both = { ...stagingOnly, PROD_OPERATOR_SECRET: 'test-only-prod-operator' };
    expect((await verify(['--base-url', 'http://localhost:48730'], both, fakeServer(secrets, both.PROD_OPERATOR_SECRET).fetchImpl)).code).toBe(0);
    expect((await verify(['--base-url', 'http://localhost:48730'], stagingOnly, fakeServer(secrets, stagingOnly.STAGING_OPERATOR_SECRET).fetchImpl)).code).toBe(0);
  });

  it('reports the operator rejection without echoing the secret', async () => {
    const { fetchImpl } = fakeServer(server, 'test-only-other-operator');
    const { code, output } = await verify(['--base-url', 'https://platform.example.test'], local, fetchImpl);
    expect(code).toBe(1);
    expect(output).toBe('secrets:verify: FAIL unauthorized: Invalid operator secret');
  });

  it.each([
    { argv: [] },
    { argv: ['--base-url', 'http://platform.example.test'] },
    { argv: ['--base-url', 'not a url'] },
    { argv: ['--base-url', 'https://platform.example.test', '--unknown'] },
  ])('refuses $argv before sending the operator secret', async ({ argv }) => {
    const { calls, fetchImpl } = fakeServer(server, local.PROD_OPERATOR_SECRET);
    expect((await verify(argv, local, fetchImpl)).code).toBe(2);
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
