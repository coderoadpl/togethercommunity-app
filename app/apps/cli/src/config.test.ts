import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CliConfig,
  CliProfile,
  ResolveCliConfigInput,
  ResolvedCliConfig,
} from './config.js';

interface ConfigModule {
  DEFAULT_DEV_API_URL: string;
  apiOrigin: (apiUrl: string) => string;
  isTogetherRepo: (cwd: string) => boolean;
  loadConfig: () => CliConfig;
  resolveCliConfig: (input: ResolveCliConfigInput) => ResolvedCliConfig;
  saveConfig: (config: CliConfig) => void;
  updateOriginProfile: (
    config: CliConfig,
    origin: string,
    patch: Partial<CliProfile>,
    setCurrent: boolean,
  ) => CliConfig;
}

const originalHome = process.env['HOME'];
const testHome = mkdtempSync(join(tmpdir(), 'together-cli-config-'));
const configDir = join(testHome, '.config', 'together');
const configFile = join(configDir, 'config.json');
const outsideRepo = join(testHome, 'outside');
const repo = join(testHome, 'renamed-checkout', 'app');
const repoChild = join(repo, 'apps', 'cli');

let config: ConfigModule;

beforeAll(async () => {
  process.env['HOME'] = testHome;
  vi.resetModules();
  config = await import('./config.js');
});

afterAll(() => {
  if (originalHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = originalHome;
  rmSync(testHome, { recursive: true, force: true });
});

beforeEach(() => {
  mkdirSync(configDir, { recursive: true });
  mkdirSync(outsideRepo, { recursive: true });
  mkdirSync(repoChild, { recursive: true });
  rmSync(configFile, { force: true });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'together' }));
});

const v2 = (
  currentOrigin = 'https://one.example',
  profiles: Record<string, CliProfile> = {},
): CliConfig => ({
  version: 2,
  currentOrigin,
  profiles,
});

describe('loadConfig', () => {
  it('returns an unwritten empty config on first run', () => {
    expect(config.loadConfig()).toEqual({
      version: 2,
      currentOrigin: config.DEFAULT_DEV_API_URL,
      profiles: {},
    });
    expect(() => statSync(configFile)).toThrow();
  });

  it('migrates a legacy profile without changing token or tenant bytes', () => {
    const token = 'tok\u0000é\n終';
    const tenant = 'tenant-with-dashes';
    writeFileSync(
      configFile,
      JSON.stringify({
        apiUrl: 'HTTPS://Example.COM:443/path?ignored=yes',
        token,
        tenant,
      }),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(config.loadConfig()).toEqual({
      version: 2,
      currentOrigin: 'https://example.com',
      profiles: {
        'https://example.com': { token, tenant },
      },
    });
    expect(JSON.parse(readFileSync(configFile, 'utf8'))).toEqual({
      version: 2,
      currentOrigin: 'https://example.com',
      profiles: {
        'https://example.com': { token, tenant },
      },
    });
    expect(error).toHaveBeenCalledExactlyOnceWith(
      'together: migrated ~/.config/together/config.json to per-origin profiles (https://example.com)',
    );
  });

  it('fails loudly on malformed JSON and leaves the file byte-for-byte unchanged', () => {
    const corrupted = '{ "token": "live", nope';
    writeFileSync(configFile, corrupted);

    expect(() => config.loadConfig()).toThrow(
      'together: invalid ~/.config/together/config.json: malformed JSON',
    );
    expect(readFileSync(configFile, 'utf8')).toBe(corrupted);
  });

  it('fails loudly on a corrupted supported format and never resets the file', () => {
    const corrupted = JSON.stringify({
      version: 2,
      currentOrigin: 'https://one.example',
      profiles: {
        'https://one.example': { token: 42, tenant: null },
      },
    });
    writeFileSync(configFile, corrupted);

    expect(() => config.loadConfig()).toThrow(
      'together: invalid ~/.config/together/config.json',
    );
    expect(readFileSync(configFile, 'utf8')).toBe(corrupted);
  });

  it('does not rewrite a valid JSON shape from a future version on read', () => {
    const future = JSON.stringify({ version: 3, currentOrigin: 'opaque', profiles: [] });
    writeFileSync(configFile, future);

    expect(config.loadConfig()).toEqual({
      version: 2,
      currentOrigin: config.DEFAULT_DEV_API_URL,
      profiles: {},
    });
    expect(readFileSync(configFile, 'utf8')).toBe(future);
  });
});

describe('saveConfig', () => {
  it('atomically writes an owner-only file and leaves no sibling temp file', () => {
    const saved = v2('https://one.example', {
      'https://one.example': { token: 'tok', tenant: 'acme' },
    });

    config.saveConfig(saved);

    expect(config.loadConfig()).toEqual(saved);
    expect(statSync(configFile).mode & 0o777).toBe(0o600);
    expect(readdirSync(configDir)).toEqual(['config.json']);
  });

  it('updates one origin without clobbering another', () => {
    const initial = v2('https://one.example', {
      'https://one.example': { token: 'one-token', tenant: 'one' },
      'https://two.example': { token: 'two-token', tenant: 'two' },
    });

    expect(
      config.updateOriginProfile(initial, 'https://two.example', { token: 'new-two' }, true),
    ).toEqual({
      version: 2,
      currentOrigin: 'https://two.example',
      profiles: {
        'https://one.example': { token: 'one-token', tenant: 'one' },
        'https://two.example': { token: 'new-two', tenant: 'two' },
      },
    });
  });
});

describe('origin selection', () => {
  const stored = v2('https://stored.example', {
    'https://stored.example': { token: 'stored-token', tenant: 'stored-tenant' },
    'https://env.example': { token: 'env-token', tenant: 'env-tenant' },
    'https://flag.example': { token: 'flag-token', tenant: 'flag-tenant' },
    'http://localhost:48730': { token: 'dev-token', tenant: 'dev-tenant' },
  });

  it('detects the repository package marker from a renamed checkout child', () => {
    expect(config.isTogetherRepo(repoChild)).toBe(true);
    expect(config.isTogetherRepo(outsideRepo)).toBe(false);
  });

  it('uses the API URL flag over env, repo detection, and stored origin', () => {
    expect(
      config.resolveCliConfig({
        config: stored,
        cwd: repoChild,
        env: { TOGETHER_CLI_API_URL: 'https://env.example/path' },
        apiUrl: 'https://FLAG.example:443/api',
      }),
    ).toMatchObject({
      apiUrl: 'https://FLAG.example:443/api',
      origin: 'https://flag.example',
      originSource: 'flag',
      profile: { token: 'flag-token', tenant: 'flag-tenant' },
    });
  });

  it('uses env over repo detection and stored origin', () => {
    expect(
      config.resolveCliConfig({
        config: stored,
        cwd: repoChild,
        env: { TOGETHER_CLI_API_URL: 'https://env.example/path' },
      }),
    ).toMatchObject({
      apiUrl: 'https://env.example/path',
      origin: 'https://env.example',
      originSource: 'env',
      profile: { token: 'env-token', tenant: 'env-tenant' },
    });
  });

  it('uses the repo default locally and currentOrigin outside the repo', () => {
    expect(
      config.resolveCliConfig({ config: stored, cwd: repoChild, env: {} }),
    ).toMatchObject({
      apiUrl: 'http://localhost:48730',
      originSource: 'repo',
      profile: { token: 'dev-token', tenant: 'dev-tenant' },
    });
    expect(
      config.resolveCliConfig({ config: stored, cwd: outsideRepo, env: {} }),
    ).toMatchObject({
      apiUrl: 'https://stored.example',
      originSource: 'stored',
      profile: { token: 'stored-token', tenant: 'stored-tenant' },
    });
  });

  it('uses tenant flag, then env, then selected profile', () => {
    const base = {
      config: stored,
      cwd: outsideRepo,
      env: { TOGETHER_CLI_API_URL: 'https://env.example' },
    };

    expect(config.resolveCliConfig({ ...base, tenant: 'flag-tenant' }).tenant).toBe('flag-tenant');
    expect(
      config.resolveCliConfig({
        ...base,
        env: {
          ...base.env,
          TOGETHER_CLI_TENANT: 'environment-tenant',
        },
      }).tenant,
    ).toBe('environment-tenant');
    expect(config.resolveCliConfig(base).tenant).toBe('env-tenant');
  });
});
