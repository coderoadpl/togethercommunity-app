import { describe, expect, it } from 'vitest';

import { secretFingerprint } from '#adapters/crypto/secret-fingerprint.js';
import { REDACTED_SECRET_FINGERPRINT_READ_SECRET } from '#core/client/index.js';
import {
  API_PATHS,
  SCHEDULER_OPERATOR_SECRET_HEADER,
  SECRET_FINGERPRINT_READ_SECRET_HEADER,
  type SecretFingerprint,
} from '#core/contract/index.js';

import { compareSecretFingerprints, formatVerdict, runSecretsVerify, verificationPassed } from './secrets-verify.js';

const local = {
  BETTER_AUTH_SECRET: 'test-only-better-auth-secret',
  CRON_SECRET: '  test-only-cron-secret\n',
  MARKETING_TICK_SECRET: 'test-only-marketing-local',
  EMAIL_DISPATCH_SECRET: 'test-only-dispatch-secret',
  SECRETS_MASTER_KEY: 'test-only-master-key',
  PROD_OPERATOR_SECRET: 'test-only-operator-secret',
  SECRET_FINGERPRINT_READ_SECRET: 'test-only-fingerprint-read-secret',
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
  set('SECRET_FINGERPRINT_READ_SECRET', local.SECRET_FINGERPRINT_READ_SECRET),
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
      { name: 'SECRET_FINGERPRINT_READ_SECRET', outcome: 'MATCH' },
    ]);
  });

  it('recognises a server value that carries a CRLF line break after the local value', () => {
    expect(compareSecretFingerprints([set('CRON_SECRET', 'test-only-cron-secret\r\n')], { CRON_SECRET: 'test-only-cron-secret' }))
      .toEqual([{ name: 'CRON_SECRET', outcome: 'MISMATCH', trimmedMatches: false, serverAddsLineBreak: true }]);
  });

  it('treats an empty local value as absent', () => {
    expect(compareSecretFingerprints([unset('SMTP_PASSWORD')], { SMTP_PASSWORD: '', CRON_SECRET: '' }))
      .toEqual([{ name: 'SMTP_PASSWORD', outcome: 'NOT IN LOCAL ENV' }]);
  });

  it('reports a supported name that is set locally but missing from the server list, and ignores unsupported names', () => {
    const operator = set('OPERATOR_SECRET', 'test-only-operator');
    expect(compareSecretFingerprints([operator], {
      OPERATOR_SECRET: 'test-only-operator',
      BETTER_AUTH_SECRET: 'test-only-better-auth-secret',
      AWS_SECRET_ACCESS_KEY: 'test-only-aws-secret',
      UNRELATED_SECRET: 'test-only-unrelated',
    })).toEqual([
      { name: 'OPERATOR_SECRET', outcome: 'MATCH' },
      { name: 'BETTER_AUTH_SECRET', outcome: 'NOT LISTED BY SERVER' },
      { name: 'AWS_SECRET_ACCESS_KEY', outcome: 'NOT LISTED BY SERVER' },
    ]);
  });
});

describe('verificationPassed', () => {
  it('passes only when every locally present name matches', () => {
    expect(verificationPassed([{ name: 'A', outcome: 'MATCH' }, { name: 'B', outcome: 'NOT IN LOCAL ENV' }])).toBe(true);
    expect(verificationPassed([{ name: 'A', outcome: 'MATCH' }, { name: 'B', outcome: 'NOT SET ON SERVER' }])).toBe(false);
    expect(verificationPassed([{ name: 'A', outcome: 'MISMATCH', trimmedMatches: true, serverAddsLineBreak: false }])).toBe(false);
    expect(verificationPassed([{ name: 'A', outcome: 'NOT IN LOCAL ENV' }])).toBe(false);
    expect(verificationPassed([{ name: 'A', outcome: 'MATCH' }, { name: 'B', outcome: 'NOT LISTED BY SERVER' }])).toBe(false);
  });
});

describe('formatVerdict', () => {
  it('names the whitespace hint of a mismatch', () => {
    expect(formatVerdict({ name: 'CRON_SECRET', outcome: 'MATCH' })).toBe('MATCH                CRON_SECRET');
    expect(formatVerdict({ name: 'CRON_SECRET', outcome: 'MISMATCH', trimmedMatches: true, serverAddsLineBreak: false }))
      .toBe('MISMATCH             CRON_SECRET  trimmed local value matches (whitespace difference)');
    expect(formatVerdict({ name: 'CRON_SECRET', outcome: 'MISMATCH', trimmedMatches: false, serverAddsLineBreak: false }))
      .toBe('MISMATCH             CRON_SECRET  trimmed local value does not match either');
    expect(formatVerdict({ name: 'CRON_SECRET', outcome: 'MISMATCH', trimmedMatches: false, serverAddsLineBreak: true }))
      .toContain('the server value is the local value followed by a line break');
  });
});

const fakeServer = (secrets: SecretFingerprint[], expectedSecret: string) => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), headers });
    return headers.get(SECRET_FINGERPRINT_READ_SECRET_HEADER) === expectedSecret
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
  it('authenticates with the read secret alone, prints one line per name and never a value', async () => {
    const { calls, fetchImpl } = fakeServer(server, local.SECRET_FINGERPRINT_READ_SECRET);
    const { code, output } = await verify(['--', '--base-url', 'https://platform.example.test'], local, fetchImpl);
    expect(code).toBe(1);
    expect(calls).toEqual([expect.objectContaining({ url: `https://platform.example.test${API_PATHS.secretFingerprints}` })]);
    expect(calls[0]?.headers.get(SECRET_FINGERPRINT_READ_SECRET_HEADER)).toBe(local.SECRET_FINGERPRINT_READ_SECRET);
    expect(calls[0]?.headers.has(SCHEDULER_OPERATOR_SECRET_HEADER)).toBe(false);
    expect(output.split('\n')).toHaveLength(server.length + 1);
    expect(output).toContain('NOT SET ON SERVER    SECRETS_MASTER_KEY');
    expect(output).toContain('NOT IN LOCAL ENV     SMTP_PASSWORD');
    expect(output).toContain('secrets:verify: FAIL (3 of 8 matched)');
    for (const value of [...Object.values(local), 'test-only']) expect(output).not.toContain(value.trim());
  });

  it('keeps a path prefix of the base URL', async () => {
    const { calls, fetchImpl } = fakeServer(server, local.SECRET_FINGERPRINT_READ_SECRET);
    await verify(['--base-url', 'https://platform.example.test/edge/'], local, fetchImpl);
    expect(calls.map((call) => call.url)).toEqual([`https://platform.example.test/edge${API_PATHS.secretFingerprints}`]);
  });

  it('compares every operator secret as an ordinary entry and exits 0 when every present name matches', async () => {
    const env = {
      OPERATOR_SECRET: 'test-only-preferred-operator',
      PROD_OPERATOR_SECRET: 'test-only-prod-operator',
      STAGING_OPERATOR_SECRET: 'test-only-staging-operator',
      SECRET_FINGERPRINT_READ_SECRET: local.SECRET_FINGERPRINT_READ_SECRET,
    };
    const { calls, fetchImpl } = fakeServer([
      set('OPERATOR_SECRET', env.OPERATOR_SECRET),
      set('PROD_OPERATOR_SECRET', env.PROD_OPERATOR_SECRET),
      set('STAGING_OPERATOR_SECRET', env.STAGING_OPERATOR_SECRET),
      set('SECRET_FINGERPRINT_READ_SECRET', env.SECRET_FINGERPRINT_READ_SECRET),
      unset('SMTP_PASSWORD'),
    ], env.SECRET_FINGERPRINT_READ_SECRET);
    const { code, output } = await verify(['--base-url', 'http://localhost:48730'], env, fetchImpl);
    expect(code).toBe(0);
    expect(calls.map((call) => call.headers.get(SECRET_FINGERPRINT_READ_SECRET_HEADER))).toEqual([env.SECRET_FINGERPRINT_READ_SECRET]);
    expect(output).toBe([
      'MATCH                OPERATOR_SECRET',
      'MATCH                PROD_OPERATOR_SECRET',
      'MATCH                STAGING_OPERATOR_SECRET',
      'MATCH                SECRET_FINGERPRINT_READ_SECRET',
      'NOT IN LOCAL ENV     SMTP_PASSWORD',
      'secrets:verify: PASS (4 of 5 matched)',
    ].join('\n'));
  });

  it('fails with its own line when the server list omits a supported name set locally', async () => {
    const env = { SECRET_FINGERPRINT_READ_SECRET: local.SECRET_FINGERPRINT_READ_SECRET, BETTER_AUTH_SECRET: local.BETTER_AUTH_SECRET };
    const { fetchImpl } = fakeServer([set('SECRET_FINGERPRINT_READ_SECRET', env.SECRET_FINGERPRINT_READ_SECRET)], env.SECRET_FINGERPRINT_READ_SECRET);
    const { code, output } = await verify(['--base-url', 'https://platform.example.test'], env, fetchImpl);
    expect(code).toBe(1);
    expect(output).toBe([
      'MATCH                SECRET_FINGERPRINT_READ_SECRET',
      'NOT LISTED BY SERVER BETTER_AUTH_SECRET',
      'secrets:verify: FAIL (1 of 2 matched)',
    ].join('\n'));
  });

  it('reports the rejection without echoing the secret', async () => {
    const { fetchImpl } = fakeServer(server, 'test-only-other-read-secret');
    const { code, output } = await verify(['--base-url', 'https://platform.example.test'], local, fetchImpl);
    expect(code).toBe(1);
    expect(output).toBe('secrets:verify: FAIL unauthorized: Invalid operator secret');
  });

  it('replaces the sent read secret in a server error that reflects it', async () => {
    const reflecting: typeof fetch = async (_url, init) => {
      const sent = new Headers(init?.headers).get(SECRET_FINGERPRINT_READ_SECRET_HEADER) ?? '';
      return Response.json({ ok: false, error: { code: 'unauthorized', message: `Rejected ${sent}`, details: { sent } } }, { status: 401 });
    };
    const { code, output } = await verify(['--base-url', 'https://platform.example.test'], local, reflecting);
    expect(code).toBe(1);
    expect(output).toBe(`secrets:verify: FAIL unauthorized: Rejected ${REDACTED_SECRET_FINGERPRINT_READ_SECRET}`);
    expect(output).not.toContain(local.SECRET_FINGERPRINT_READ_SECRET);
  });

  it('replaces a read secret with surrounding whitespace when the server echoes its header-normalized form', async () => {
    const reflecting: typeof fetch = async (_url, init) => {
      const received = new Headers(init?.headers).get(SECRET_FINGERPRINT_READ_SECRET_HEADER) ?? '';
      return Response.json({ ok: false, error: { code: 'unauthorized', message: `Rejected ${received}`, details: { received } } }, { status: 401 });
    };
    const env = { ...local, SECRET_FINGERPRINT_READ_SECRET: ` ${local.SECRET_FINGERPRINT_READ_SECRET}\n` };
    const { code, output } = await verify(['--base-url', 'https://platform.example.test'], env, reflecting);
    expect(code).toBe(1);
    expect(output).toBe(`secrets:verify: FAIL unauthorized: Rejected ${REDACTED_SECRET_FINGERPRINT_READ_SECRET}`);
    expect(output).not.toContain(local.SECRET_FINGERPRINT_READ_SECRET);
  });

  const baseUrlRefusal = '--base-url must be an https URL, or http on a local host, without a query or fragment';
  const missingValue = '--base-url needs a value';
  const unknownOption = 'unknown option; only --base-url is accepted';
  const unexpectedArgument = 'unexpected argument; pass a value only to --base-url';
  const marker = 'test-only-argv-marker';

  it.each([
    { argv: [marker], message: unexpectedArgument },
    { argv: [`--${marker}`], message: unknownOption },
    { argv: ['--base-url', 'https://platform.example.test', marker], message: unexpectedArgument },
    { argv: ['--base-url', 'https://platform.example.test', `--auth-with=${marker}`], message: unknownOption },
    { argv: [`--base-url=${marker}`], message: baseUrlRefusal },
  ])('prints a fixed message for $argv without echoing an argument', async ({ argv, message }) => {
    const { calls, fetchImpl } = fakeServer(server, local.SECRET_FINGERPRINT_READ_SECRET);
    const { code, output } = await verify(argv, local, fetchImpl);
    expect(code).toBe(2);
    expect(calls).toEqual([]);
    expect(output).toContain(`secrets:verify: ${message}`);
    expect(output).not.toContain(marker);
  });

  it.each([
    { argv: [], message: baseUrlRefusal },
    { argv: ['--base-url', 'http://platform.example.test'], message: baseUrlRefusal },
    { argv: ['--base-url', 'not a url'], message: baseUrlRefusal },
    { argv: ['--base-url', 'https://platform.example.test/?target=other'], message: baseUrlRefusal },
    { argv: ['--base-url', 'https://platform.example.test', '--unknown'], message: unknownOption },
    { argv: ['--base-url', 'https://platform.example.test', '--auth-with', 'PROD_OPERATOR_SECRET'], message: unknownOption },
    { argv: ['--base-url'], message: missingValue },
  ])('refuses $argv before sending the read secret', async ({ argv, message }) => {
    const { calls, fetchImpl } = fakeServer(server, local.SECRET_FINGERPRINT_READ_SECRET);
    const { code, output } = await verify(argv, local, fetchImpl);
    expect(code).toBe(2);
    expect(output).toBe(`usage: pnpm --silent run secrets:verify -- --base-url <https://host>\nsecrets:verify: ${message}`);
    expect(calls).toEqual([]);
  });

  it('refuses to run without the read secret, even when operator secrets are present', async () => {
    const { calls, fetchImpl } = fakeServer(server, local.SECRET_FINGERPRINT_READ_SECRET);
    const env = { OPERATOR_SECRET: 'test-only-operator', PROD_OPERATOR_SECRET: local.PROD_OPERATOR_SECRET, SECRET_FINGERPRINT_READ_SECRET: '' };
    const { code, output } = await verify(['--base-url', 'https://platform.example.test'], env, fetchImpl);
    expect(code).toBe(2);
    expect(output).toBe('secrets:verify: SECRET_FINGERPRINT_READ_SECRET is required in the environment');
    expect(calls).toEqual([]);
  });
});
