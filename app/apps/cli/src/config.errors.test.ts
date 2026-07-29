import { afterEach, describe, expect, it, vi } from 'vitest';

interface FsError extends Error {
  code: string;
}

const configFile = '/test-home/.config/together/config.json';
const saved = {
  version: 2 as const,
  currentOrigin: 'https://one.example',
  profiles: {
    'https://one.example': { token: 'live-token', tenant: 'acme' },
  },
};

const createHarness = () => {
  const files = new Map<string, string>();
  const mkdirSync = vi.fn();
  const readFileSync = vi.fn((path: string) => {
    const content = files.get(path);
    if (content !== undefined) return content;
    const error: FsError = Object.assign(new Error('missing'), { code: 'ENOENT' });
    throw error;
  });
  const renameSync = vi.fn((from: string, to: string) => {
    const content = files.get(from);
    if (content === undefined) throw new Error('missing temporary file');
    files.set(to, content);
    files.delete(from);
  });
  const rmSync = vi.fn((path: string) => {
    files.delete(path);
  });
  const writeFileSync = vi.fn((path: string, content: string) => {
    files.set(path, content);
  });
  return { files, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync };
};

const loadConfigWith = async (harness: ReturnType<typeof createHarness>) => {
  vi.doMock('node:fs', () => ({
    mkdirSync: harness.mkdirSync,
    readFileSync: harness.readFileSync,
    renameSync: harness.renameSync,
    rmSync: harness.rmSync,
    writeFileSync: harness.writeFileSync,
  }));
  vi.doMock('node:os', () => ({ homedir: () => '/test-home' }));
  vi.resetModules();
  return import('./config.js');
};

afterEach(() => {
  vi.doUnmock('node:fs');
  vi.doUnmock('node:os');
  vi.resetModules();
});

describe('config error paths', () => {
  it('rejects malformed JSON without rewriting it', async () => {
    const harness = createHarness();
    const malformed = '{"version":2,';
    harness.files.set(configFile, malformed);
    const config = await loadConfigWith(harness);

    expect(() => config.loadConfig()).toThrow('malformed JSON');
    expect(harness.files.get(configFile)).toBe(malformed);
    expect(harness.writeFileSync).not.toHaveBeenCalled();
  });

  it.each([
    ['legacy', { apiUrl: 'https://one.example', token: 42, tenant: null }],
    [
      'profile',
      {
        version: 2,
        currentOrigin: 'https://one.example',
        profiles: {
          'https://one.example': { token: 'token', tenant: null, extra: true },
        },
      },
    ],
  ])('rejects an invalid %s shape without replacing it', async (_label, value) => {
    const harness = createHarness();
    const invalid = JSON.stringify(value);
    harness.files.set(configFile, invalid);
    const config = await loadConfigWith(harness);

    expect(() => config.loadConfig()).toThrow(
      'together: invalid ~/.config/together/config.json',
    );
    expect(harness.files.get(configFile)).toBe(invalid);
    expect(harness.writeFileSync).not.toHaveBeenCalled();
  });

  it('ignores a future version without rewriting it', async () => {
    const harness = createHarness();
    const future = JSON.stringify({
      version: 3,
      currentOrigin: 'https://future.example',
      profiles: {},
    });
    harness.files.set(configFile, future);
    const config = await loadConfigWith(harness);

    expect(config.loadConfig()).toEqual({
      version: 2,
      currentOrigin: config.DEFAULT_DEV_API_URL,
      profiles: {},
    });
    expect(harness.files.get(configFile)).toBe(future);
    expect(harness.writeFileSync).not.toHaveBeenCalled();
  });

  it('writes through an owner-only temporary file before atomically renaming it', async () => {
    const harness = createHarness();
    const config = await loadConfigWith(harness);

    config.saveConfig(saved);

    expect(harness.writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/\.config\.json\.\d+\.\d+\.tmp$/),
      `${JSON.stringify(saved, null, 2)}\n`,
      {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      },
    );
    const tempFile = harness.writeFileSync.mock.calls[0]?.[0];
    expect(harness.renameSync).toHaveBeenCalledWith(tempFile, configFile);
    expect(harness.files.get(configFile)).toBe(`${JSON.stringify(saved, null, 2)}\n`);
    expect([...harness.files.keys()]).toEqual([configFile]);
  });
});
