import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntitlementClientOptions } from '#core/client/index.js';
import { ok, type EntitlementCheckInput, type EntitlementCheckOutput } from '#core/domain/index.js';

import { DEFAULT_ENTITLEMENT_KEY_ENV, formatEntitlementCheck, parseSubjectLines, registerEntitlementCommands } from './entitlement-commands.js';

const output: EntitlementCheckOutput = {
  version: 1,
  results: [
    {
      subject: { email: 'ada@example.test' },
      products: [{
        productId: 'prod-pro', access: true, source: 'subscription',
        subscription: { status: 'active', currentPeriodEnd: '2026-12-20T00:00:00.000Z', cancelAtPeriodEnd: true },
        checkedAt: '2026-11-20T12:00:00.000Z',
      }],
      member: { id: 'm-ada' },
    },
    { subject: { memberId: 'm-none' }, products: [], member: null },
  ],
};

const run = async (args: string[]) => {
  const calls: { options: EntitlementClientOptions; input: EntitlementCheckInput }[] = [];
  const program = new Command().option('--json').exitOverride();
  registerEntitlementCommands(
    program,
    () => ok({ apiUrl: 'https://platform.example.test', tenant: 'acme', json: true }),
    (options) => ({ check: async (input) => { calls.push({ options, input }); return ok(output); } }),
  );
  const printed: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((line: unknown) => { printed.push(String(line)); });
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => { printed.push(String(chunk)); return true; });
  try {
    await program.parseAsync(['node', 'together', ...args]);
  } finally {
    log.mockRestore();
    write.mockRestore();
  }
  return { calls, printed: printed.join('') };
};

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'together-entitlement-cli-'));
  process.env[DEFAULT_ENTITLEMENT_KEY_ENV] = 'entitlement-secret';
});

afterEach(async () => {
  delete process.env[DEFAULT_ENTITLEMENT_KEY_ENV];
  delete process.env['OTHER_KEY'];
  process.exitCode = undefined;
  await rm(directory, { recursive: true, force: true });
});

describe('together entitlement check', () => {
  it('sends the subjects of a file, the flags and the products with the key from the environment', async () => {
    const file = join(directory, 'subjects.txt');
    await writeFile(file, '# people to check\nada@example.test\n\nmember:m-none\n');
    const { calls, printed } = await run(['entitlement', 'check', '--subjects-file', file, '--email', 'bob@example.test', '--product', 'prod-pro']);
    expect(calls).toEqual([{
      options: { baseUrl: 'https://platform.example.test', apiKey: 'entitlement-secret', tenant: 'acme' },
      input: { subjects: [{ email: 'ada@example.test' }, { memberId: 'm-none' }, { email: 'bob@example.test' }], productIds: ['prod-pro'] },
    }]);
    expect(printed).toContain('"version": 1');
  });

  it('reads the key from a named environment variable and refuses to run without one', async () => {
    process.env['OTHER_KEY'] = 'other-secret';
    expect((await run(['entitlement', 'check', '--email', 'ada@example.test', '--api-key-env', 'OTHER_KEY'])).calls[0]?.options.apiKey).toBe('other-secret');
    delete process.env[DEFAULT_ENTITLEMENT_KEY_ENV];
    const refused = await run(['entitlement', 'check', '--email', 'ada@example.test']);
    expect(refused.calls).toEqual([]);
    expect(refused.printed).toContain(DEFAULT_ENTITLEMENT_KEY_ENV);
  });

  it('refuses to call the server without a subject', async () => {
    const { calls, printed } = await run(['entitlement', 'check']);
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
