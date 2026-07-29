import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { appError, err, ok } from '#core/domain/index.js';

import pkg from '../../../package.json' with { type: 'json' };

import type { CliConfig, CliProfile, ResolveCliConfigInput } from './config.js';

interface Hoisted {
  config: CliConfig;
  loadError: Error | null;
  saved: CliConfig[];
  health: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
}

const h = vi.hoisted(
  (): Hoisted => ({
    config: {
      version: 2,
      currentOrigin: 'https://one.example',
      profiles: {
        'https://one.example': { token: 'secret-one', tenant: 'one' },
        'https://two.example': { token: null, tenant: null },
      },
    },
    loadError: null,
    saved: [],
    health: vi.fn(),
    signOut: vi.fn(),
  }),
);

vi.mock('./config.js', () => ({
  apiOrigin: (apiUrl: string): string => new URL(apiUrl).origin,
  loadConfig: (): CliConfig => {
    if (h.loadError !== null) throw h.loadError;
    return h.config;
  },
  resolveCliConfig: (input: ResolveCliConfigInput) => {
    const apiUrl = input.apiUrl ?? input.env.TOGETHER_CLI_API_URL ?? input.config.currentOrigin;
    const origin = new URL(apiUrl).origin;
    const profile = input.config.profiles[origin] ?? { token: null, tenant: null };
    return {
      apiUrl,
      origin,
      originSource: input.apiUrl === undefined ? 'stored' as const : 'flag' as const,
      profile,
      tenant: input.tenant ?? input.env.TOGETHER_CLI_TENANT ?? profile.tenant,
    };
  },
  saveConfig: (config: CliConfig): void => {
    h.saved.push(config);
  },
  updateOriginProfile: (
    config: CliConfig,
    origin: string,
    patch: Partial<CliProfile>,
    setCurrent: boolean,
  ): CliConfig => ({
    ...config,
    currentOrigin: setCurrent ? origin : config.currentOrigin,
    profiles: {
      ...config.profiles,
      [origin]: {
        ...(config.profiles[origin] ?? { token: null, tenant: null }),
        ...patch,
      },
    },
  }),
}));

vi.mock('#core/client/index.js', () => ({
  createApiClient: () => ({
    health: h.health,
  }),
}));

vi.mock('#adapters/auth/client-adapter.js', () => ({
  createCliAuthAdapter: () => ({
    signOut: h.signOut,
  }),
}));

const originalArgv = process.argv;
let logSpy: MockInstance<typeof console.log>;
let errorSpy: MockInstance<typeof console.error>;

const run = async (...args: string[]): Promise<void> => {
  process.argv = ['node', 'together', ...args];
  vi.resetModules();
  await import('./main.js');
};

const soleJson = (): unknown => {
  expect(logSpy).toHaveBeenCalledTimes(1);
  return JSON.parse(String(logSpy.mock.calls[0]?.[0]));
};

beforeEach(() => {
  h.loadError = null;
  h.saved = [];
  h.health.mockReset();
  h.health.mockResolvedValue(ok({
    status: 'ok',
    database: 'up',
    version: '0.1.0',
    sha: 'cafe1234',
  }));
  h.signOut.mockReset();
  h.signOut.mockResolvedValue(ok(undefined));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.exitCode = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

afterAll(() => {
  process.argv = originalArgv;
});

describe('one-envelope discipline', () => {
  it('emits one validation envelope for an unknown command', async () => {
    await run('--json', 'bogus-command');

    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });

  it('emits one internal envelope for a fatal config error', async () => {
    h.loadError = new Error('together: invalid ~/.config/together/config.json: malformed JSON');

    await run('--json', 'health');

    expect(h.health).not.toHaveBeenCalled();
    expect(soleJson()).toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'together: invalid ~/.config/together/config.json: malformed JSON',
      },
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(10);
  });

  it('validates global options before constructing transport', async () => {
    await run('--json', '--api-url', 'not-a-url', 'health');

    expect(h.health).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });
});

describe('version identity', () => {
  it('emits the manifest version without calling health', async () => {
    await run('--json', 'version');

    expect(soleJson()).toEqual({
      ok: true,
      data: { name: 'together', version: pkg.version },
    });
    expect(h.health).not.toHaveBeenCalled();
  });

  it('prints the manifest version for --version without calling health', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run('--version');

    expect(stdoutSpy).toHaveBeenCalledWith(`${pkg.version}\n`);
    expect(h.health).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it('emits the manifest version envelope for --json --version without calling health', async () => {
    await run('--json', '--version');

    expect(soleJson()).toEqual({
      ok: true,
      data: { name: 'together', version: pkg.version },
    });
    expect(h.health).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });
});

describe('origin profiles', () => {
  it('lists origins without exposing token values', async () => {
    await run('--json', 'origin', 'list');

    const output = soleJson();
    expect(output).toMatchObject({
      ok: true,
      data: {
        origins: [
          { origin: 'https://one.example', current: true, hasToken: true, tenant: 'one' },
          { origin: 'https://two.example', current: false, hasToken: false, tenant: null },
        ],
      },
    });
    expect(JSON.stringify(output)).not.toContain('secret-one');
  });

  it('selects a canonical origin without a network call', async () => {
    await run('origin', 'use', 'HTTPS://TWO.example:443/path');

    expect(h.health).not.toHaveBeenCalled();
    expect(h.saved.at(-1)?.currentOrigin).toBe('https://two.example');
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('active origin: https://two.example');
  });

  it('revokes the server session before clearing the active token', async () => {
    await run('logout');

    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.saved.at(-1)?.profiles['https://one.example']).toEqual({
      token: null,
      tenant: 'one',
    });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('signed out');
  });

  it('preserves a failed sign-out result while clearing the local token', async () => {
    h.signOut.mockResolvedValue(err(appError('internal', 'sign-out failed')));

    await run('--json', 'logout');

    expect(soleJson()).toMatchObject({
      ok: false,
      error: { code: 'internal', message: 'sign-out failed' },
    });
    expect(h.saved.at(-1)?.profiles['https://one.example']?.token).toBeNull();
    expect(process.exitCode).toBe(10);
  });
});
