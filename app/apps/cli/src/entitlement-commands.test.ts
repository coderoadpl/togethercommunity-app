import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApplicationClientOptions } from '#core/client/index.js';
import { ok, type EntitlementCheckInput, type EntitlementCheckOutput } from '#core/domain/index.js';

import { DEFAULT_APPLICATION_KEY_ENV, formatApplicationKeys, formatEntitlementCheck, parseSubjectLines, runEntitlementCheck } from './entitlement-commands.js';

const output: EntitlementCheckOutput = {
  version: 1,
  results: [
    {
      subject: { email: 'ada@example.test' },
      identity: 'verified',
      products: [{
        productId: 'prod-pro', access: true, source: 'subscription',
        subscription: { status: 'active', currentPeriodEnd: '2026-12-20T00:00:00.000Z', cancelAtPeriodEnd: true },
        checkedAt: '2026-11-20T12:00:00.000Z',
      }],
      member: { id: 'm-ada' },
    },
    { subject: { memberId: 'm-none' }, identity: null, products: [], member: null },
  ],
};

const run = async (options: Record<string, unknown>) => {
  const calls: { options: ApplicationClientOptions; input: EntitlementCheckInput }[] = [];
  const printed: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((line: unknown) => { printed.push(String(line)); });
  const error = vi.spyOn(console, 'error').mockImplementation((line: unknown) => { printed.push(String(line)); });
  try {
    await runEntitlementCheck(
      { apiKeyEnv: DEFAULT_APPLICATION_KEY_ENV, ...options },
      () => ok({ apiUrl: 'https://platform.example.test', tenant: 'acme', json: true }),
      true,
      (clientOptions) => ({ checkEntitlements: async (input) => { calls.push({ options: clientOptions, input }); return ok(output); } }),
    );
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  return { calls, printed: printed.join('') };
};

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'together-entitlement-cli-'));
  vi.stubEnv(DEFAULT_APPLICATION_KEY_ENV, 'entitlement-secret');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  await rm(directory, { recursive: true, force: true });
});

describe('runEntitlementCheck', () => {
  it('sends the subjects of a file, the flags and the products with the key from the environment', async () => {
    const file = join(directory, 'subjects.txt');
    await writeFile(file, '# people to check\nada@example.test\n\nmember:m-none\n');
    const { calls, printed } = await run({ subjectsFile: file, email: ['bob@example.test'], product: ['prod-pro'] });
    expect(calls).toEqual([{
      options: { baseUrl: 'https://platform.example.test', apiKey: 'entitlement-secret', tenant: 'acme' },
      input: { subjects: [{ email: 'ada@example.test' }, { memberId: 'm-none' }, { email: 'bob@example.test' }], productIds: ['prod-pro'] },
    }]);
    expect(printed).toContain('"version": 1');
  });

  it('reads the key from a named environment variable and refuses to run without one', async () => {
    vi.stubEnv('OTHER_KEY', 'other-secret');
    expect((await run({ email: ['ada@example.test'], apiKeyEnv: 'OTHER_KEY' })).calls[0]?.options.apiKey).toBe('other-secret');
    vi.stubEnv(DEFAULT_APPLICATION_KEY_ENV, '');
    const refused = await run({ email: ['ada@example.test'] });
    expect(refused.calls).toEqual([]);
    expect(refused.printed).toContain(DEFAULT_APPLICATION_KEY_ENV);
  });

  it('refuses to call the server without a subject', async () => {
    const { calls, printed } = await run({});
    expect(calls).toEqual([]);
    expect(printed).toContain('Name at least one subject');
  });
});

describe('entitlement check output', () => {
  it('parses member lines and skips comments and blank lines', () => {
    expect(parseSubjectLines('a@example.test\r\n#x\n  member: m-1 \n')).toEqual([{ email: 'a@example.test' }, { memberId: 'm-1' }]);
  });

  it('prints one line per product and says no access for an empty answer', () => {
    expect(formatEntitlementCheck(output)).toBe([
      'ada@example.test (m-ada)',
      '  prod-pro\taccess\tsource=subscription\tsubscription=active\tperiodEnd=2026-12-20T00:00:00.000Z\tcancelAtPeriodEnd',
      'member m-none',
      '  no access',
    ].join('\n'));
  });
});

describe('application key list output', () => {
  const key = {
    id: 'ek-1', tenantId: 'acme', name: 'Companion app', scopes: ['entitlements:check' as const], productIds: null,
    issuedByUserId: 'owner-1', createdAt: '2026-11-01T00:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z', revokedAt: null,
  };

  it('prints revoked, expired or active, an unrevoked key past its expiry being expired', () => {
    const now = Date.parse('2026-11-20T12:00:00.000Z');
    expect(formatApplicationKeys([
      key,
      { ...key, id: 'ek-2', expiresAt: '2026-11-20T12:00:00.000Z' },
      { ...key, id: 'ek-3', expiresAt: '2026-11-01T00:00:00.000Z', revokedAt: '2026-11-02T00:00:00.000Z', productIds: ['prod-a', 'prod-b'] },
    ], now).split('\n')).toEqual([
      'Companion app\tactive\texpires 2026-12-01T00:00:00.000Z\tentitlements:check\tall products\t(ek-1)',
      'Companion app\texpired\texpires 2026-11-20T12:00:00.000Z\tentitlements:check\tall products\t(ek-2)',
      'Companion app\trevoked\texpires 2026-11-01T00:00:00.000Z\tentitlements:check\tprod-a,prod-b\t(ek-3)',
    ]);
    expect(formatApplicationKeys([], now)).toBe('no application keys');
  });
});
