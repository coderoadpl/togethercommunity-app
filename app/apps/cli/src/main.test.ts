import type * as ClientModule from '#core/client/index.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { appError, err, ok, PASSWORD_MIN_LENGTH } from '#core/domain/index.js';

import pkg from '../../../package.json' with { type: 'json' };

import type { CliConfig, CliProfile, ResolveCliConfigInput } from './config.js';

const OLD_PASSWORD = 'old-password'.padEnd(PASSWORD_MIN_LENGTH, 'x');
const NEW_PASSWORD = 'new-password'.padEnd(PASSWORD_MIN_LENGTH, 'x');

interface Hoisted {
  config: CliConfig;
  loadError: Error | null;
  saved: CliConfig[];
  health: ReturnType<typeof vi.fn>;
  configureStorage: ReturnType<typeof vi.fn>;
  changePassword: ReturnType<typeof vi.fn>;
  requestPasswordReset: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  signIn: ReturnType<typeof vi.fn>;
  verifyTotp: ReturnType<typeof vi.fn>;
  verifyBackupCode: ReturnType<typeof vi.fn>;
  configureStripe: ReturnType<typeof vi.fn>;
  getTenantSettings: ReturnType<typeof vi.fn>;
  updateTenantSettings: ReturnType<typeof vi.fn>;
  getTenantRouting: ReturnType<typeof vi.fn>;
  getTenantRedirects: ReturnType<typeof vi.fn>;
  createTenantRedirect: ReturnType<typeof vi.fn>;
  deleteTenantRedirect: ReturnType<typeof vi.fn>;
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
    configureStorage: vi.fn(),
    changePassword: vi.fn(),
    requestPasswordReset: vi.fn(),
    signOut: vi.fn(),
    signIn: vi.fn(),
    verifyTotp: vi.fn(),
    verifyBackupCode: vi.fn(),
    configureStripe: vi.fn(),
    getTenantSettings: vi.fn(),
    updateTenantSettings: vi.fn(),
    getTenantRouting: vi.fn(),
    getTenantRedirects: vi.fn(),
    createTenantRedirect: vi.fn(),
    deleteTenantRedirect: vi.fn(),
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

vi.mock('#core/client/index.js', async (importOriginal) => ({
  ...await importOriginal<typeof ClientModule>(),
  createApiClient: () => ({
    getTenantSettings: h.getTenantSettings,
    updateTenantSettings: h.updateTenantSettings,
    health: h.health,
    configureStorage: h.configureStorage,
    configureStripe: h.configureStripe,
    getTenantRouting: h.getTenantRouting,
    getTenantRedirects: h.getTenantRedirects,
    createTenantRedirect: h.createTenantRedirect,
    deleteTenantRedirect: h.deleteTenantRedirect,
  }),
}));

vi.mock('#adapters/auth/client-adapter.js', () => ({
  createCliAuthAdapter: () => ({
    changePassword: h.changePassword,
    requestPasswordReset: h.requestPasswordReset,
    signOut: h.signOut,
    signIn: h.signIn,
    verifyTotp: h.verifyTotp,
    verifyBackupCode: h.verifyBackupCode,
  }),
}));

const redirectFixture = {
  id: 'redirect-legacy',
  tenantId: 'tenant-one',
  fromPath: '/legacy/one',
  targetKind: 'course' as const,
  targetId: 'course-js',
  targetPath: '/my/courses/course-js',
  permanent: true,
  origin: 'import' as const,
  createdBy: null,
  createdAt: '1998-08-14T10:00:00.000Z',
};

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
    environment: 'test',
    production: false,
    commit: 'cafe1234',
    databaseFingerprint: null,
    expectedMigrations: 82,
    appliedMigrations: 82,
    schemaCurrent: true,
    schemaFingerprint: 'c087b16a6bb6',
    schemaFingerprintMatch: true,
  }));
  h.configureStorage.mockReset();
  h.configureStorage.mockResolvedValue(ok({
    diagnostic: { code: 'storage.available', message: 'Storage completed the probe.' },
    secret: { key: 's3.configuration', maskedPreview: '••••', updatedAt: '2026-08-03T12:00:00.000Z' },
  }));
  h.signOut.mockReset();
  h.signOut.mockResolvedValue(ok(undefined));
  h.signIn.mockReset();
  h.signIn.mockResolvedValue(ok({ token: 'session-token', twoFactorRedirect: false }));
  h.verifyTotp.mockReset();
  h.verifyTotp.mockResolvedValue(ok({ token: 'two-factor-token', twoFactorRedirect: false }));
  h.verifyBackupCode.mockReset();
  h.verifyBackupCode.mockResolvedValue(ok({ token: 'backup-token', twoFactorRedirect: false }));
  h.changePassword.mockReset();
  h.changePassword.mockResolvedValue(ok(undefined));
  h.requestPasswordReset.mockReset();
  h.requestPasswordReset.mockResolvedValue(ok(undefined));
  h.configureStripe.mockReset();
  h.configureStripe.mockResolvedValue(ok({
    mode: 'test',
    webhookUrl: 'https://app.example.test/base/api/webhooks/stripe/tenant-1',
  }));
  h.getTenantRedirects.mockReset();
  h.getTenantRedirects.mockResolvedValue(ok({ redirects: [redirectFixture], total: 1 }));
  h.createTenantRedirect.mockReset();
  h.createTenantRedirect.mockResolvedValue(ok({ redirect: redirectFixture }));
  h.deleteTenantRedirect.mockReset();
  h.deleteTenantRedirect.mockResolvedValue(ok({ id: redirectFixture.id }));
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

  it('prints the manifest version for the version command without calling health', async () => {
    await run('version');

    expect(logSpy).toHaveBeenCalledExactlyOnceWith(pkg.version);
    expect(h.health).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
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

describe('storage configure', () => {
  it('sends the whole connection to the probing endpoint and prints its diagnostic', async () => {
    await run(
      'storage',
      'configure',
      '--provider',
      'minio',
      '--endpoint',
      'http://localhost:9000',
      '--region',
      'us-east-1',
      '--bucket',
      'studio-files',
      '--access-key-id',
      'minio-access',
      '--secret-access-key',
      'minio-secret',
    );

    expect(h.configureStorage).toHaveBeenCalledExactlyOnceWith({
      provider: 'minio',
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'studio-files',
      accessKeyId: 'minio-access',
      secretAccessKey: 'minio-secret',
    });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('Storage completed the probe.');
    expect(process.exitCode).toBe(0);
  });

  it('rejects an unknown provider before calling the API', async () => {
    await run(
      'storage',
      'configure',
      '--provider',
      'dropbox',
      '--endpoint',
      'http://localhost:9000',
      '--region',
      'us-east-1',
      '--bucket',
      'studio-files',
      '--access-key-id',
      'minio-access',
      '--secret-access-key',
      'minio-secret',
    );

    expect(h.configureStorage).not.toHaveBeenCalled();
    expect(process.exitCode).not.toBe(0);
  });
});

describe('change-password', () => {
  it('emits the documented JSON result without exposing transport state', async () => {
    await run(
      '--json',
      'change-password',
      '--current-password',
      OLD_PASSWORD,
      '--new-password',
      NEW_PASSWORD,
      '--sign-out-other-sessions',
    );

    expect(h.changePassword).toHaveBeenCalledExactlyOnceWith({
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
      revokeOtherSessions: true,
    });
    const output = soleJson();
    expect(output).toEqual({
      ok: true,
      data: { changed: true, revokedOtherSessions: true },
    });
    expect(JSON.stringify(output)).not.toContain('secret-one');
    expect(process.exitCode).toBe(0);
  });

  it('returns exit 2 when the current password is rejected', async () => {
    h.changePassword.mockResolvedValue(err(appError('validation', 'Invalid password')));

    await run(
      '--json',
      'change-password',
      '--current-password',
      'wrong-password',
      '--new-password',
      NEW_PASSWORD,
    );

    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });

  it('returns exit 3 when there is no authenticated session', async () => {
    h.changePassword.mockResolvedValue(err(appError('unauthorized', 'Authentication required')));

    await run(
      '--json',
      'change-password',
      '--current-password',
      OLD_PASSWORD,
      '--new-password',
      NEW_PASSWORD,
    );

    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
    expect(process.exitCode).toBe(3);
  });

  it('rejects a new password below the shared minimum before calling the adapter', async () => {
    await run(
      '--json',
      'change-password',
      '--current-password',
      OLD_PASSWORD,
      '--new-password',
      'short',
    );

    expect(h.changePassword).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });
});

describe('request-password-reset', () => {
  it('derives redirectTo from the API URL origin', async () => {
    await run(
      '--json',
      '--api-url',
      'https://studio.example/api-prefix',
      'request-password-reset',
      '--email',
      'member@example.com',
      '--language',
      'en',
    );

    expect(h.requestPasswordReset).toHaveBeenCalledExactlyOnceWith({
      email: 'member@example.com',
      redirectTo: 'https://studio.example/reset-password',
      language: 'en',
    });
    expect(soleJson()).toEqual({ ok: true });
    expect(process.exitCode).toBe(0);
  });
});

describe('login two-factor challenge', () => {
  it('completes a password challenge with a TOTP code before storing the session', async () => {
    h.signIn.mockResolvedValue(ok({ token: null, twoFactorRedirect: true }));

    await run(
      'login',
      '--email',
      'member@example.com',
      '--password',
      'secret12',
      '--totp-code',
      '123456',
    );

    expect(h.verifyTotp).toHaveBeenCalledExactlyOnceWith('123456');
    expect(h.saved.at(-1)?.profiles['https://one.example']?.token).toBe('two-factor-token');
  });

  it('supports a backup code and refuses to persist the provisional result', async () => {
    h.signIn.mockResolvedValue(ok({ token: null, twoFactorRedirect: true }));

    await run(
      'login',
      '--email',
      'member@example.com',
      '--password',
      'secret12',
      '--backup-code',
      'backup-once',
    );

    expect(h.verifyBackupCode).toHaveBeenCalledExactlyOnceWith('backup-once');
    expect(h.saved.at(-1)?.profiles['https://one.example']?.token).toBe('backup-token');
  });

  it('requires a second-factor option when the provider returns a challenge', async () => {
    h.signIn.mockResolvedValue(ok({ token: null, twoFactorRedirect: true }));

    await run(
      '--json',
      'login',
      '--email',
      'member@example.com',
      '--password',
      'secret12',
    );

    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.saved).toHaveLength(0);
  });
});

describe('stripe configure', () => {
  it('registers the webhook through the same API used by the integrations panel', async () => {
    await run('stripe', 'configure', 'rk_test_private');

    expect(h.configureStripe).toHaveBeenCalledExactlyOnceWith({ restrictedKey: 'rk_test_private' });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith(
      'configured Stripe in test mode\nwebhook https://app.example.test/base/api/webhooks/stripe/tenant-1',
    );
  });
});

describe('redirect commands', () => {
  it('emits one list envelope carrying the page total', async () => {
    await run('--json', 'redirect', 'list', '--search', 'legacy', '--limit', '2', '--offset', '4');

    expect(h.getTenantRedirects).toHaveBeenCalledExactlyOnceWith({
      search: 'legacy',
      limit: 2,
      offset: 4,
    });
    expect(soleJson()).toMatchObject({
      ok: true,
      data: { total: 1, redirects: [{ fromPath: '/legacy/one', origin: 'import' }] },
    });
  });

  it('sends a lesson target and defaults to a permanent redirect', async () => {
    await run('redirect', 'create', '--from', '/legacy/one', '--course', 'course-js', '--lesson', 'lesson-1');

    expect(h.createTenantRedirect).toHaveBeenCalledExactlyOnceWith({
      fromPath: '/legacy/one',
      target: { kind: 'lesson', courseId: 'course-js', lessonId: 'lesson-1' },
      permanent: true,
    });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith(
      'created redirect /legacy/one -> /my/courses/course-js (redirect-legacy)',
    );
  });

  it('sends a path target as temporary when asked', async () => {
    await run('--json', 'redirect', 'create', '--from', '/legacy/two', '--path', '/my', '--temporary');

    expect(h.createTenantRedirect).toHaveBeenCalledExactlyOnceWith({
      fromPath: '/legacy/two',
      target: { kind: 'path', path: '/my' },
      permanent: false,
    });
    expect(soleJson()).toMatchObject({ ok: true, data: { redirect: { id: 'redirect-legacy' } } });
  });

  it('emits one validation envelope when no target is given', async () => {
    await run('--json', 'redirect', 'create', '--from', '/legacy/three');

    expect(h.createTenantRedirect).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });

  it('emits one validation envelope for a lesson without its course', async () => {
    await run('--json', 'redirect', 'create', '--from', '/legacy/four', '--lesson', 'lesson-1');

    expect(h.createTenantRedirect).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('emits one validation envelope when a path and a course target are combined', async () => {
    await run(
      '--json', 'redirect', 'create',
      '--from', '/legacy/five', '--path', '/oferta', '--course', 'course-js',
    );

    expect(h.createTenantRedirect).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('emits one delete envelope', async () => {
    await run('--json', 'redirect', 'delete', 'redirect-legacy');

    expect(h.deleteTenantRedirect).toHaveBeenCalledExactlyOnceWith({ id: 'redirect-legacy' });
    expect(soleJson()).toEqual({ ok: true, data: { id: 'redirect-legacy' } });
  });

  it('reports an upstream conflict with the taxonomy exit code', async () => {
    h.createTenantRedirect.mockResolvedValue(err(appError('conflict', 'Another redirect already answers "/legacy/one"')));

    await run('--json', 'redirect', 'create', '--from', '/legacy/one', '--path', '/my');

    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(process.exitCode).toBe(6);
  });
});

describe('domain show', () => {
  const routing = {
    tenantHost: 'workspace.example.org',
    customDomainTarget: 'routing.example.org',
    apexDomainsSupported: false,
    canAddCustomDomain: true,
    customDomains: [{
      domain: 'courses.example.org', verified: false, status: 'pending-dns',
      lastCheckedAt: null, lastError: null,
      records: [
        { type: 'CNAME', name: 'courses.example.org', value: 'routing.example.org', purpose: 'routing', status: 'pending' },
        { type: 'TXT', name: '_vercel.courses.example.org', value: 'challenge', purpose: 'ownership', status: 'verified' },
      ],
    }],
  };

  it('preserves records and statuses in the JSON envelope', async () => {
    h.getTenantRouting.mockResolvedValue(ok({ routing }));
    await run('--json', 'domain', 'show');
    expect(soleJson()).toEqual({ ok: true, data: { routing } });
  });

  it('prints every record and its status', async () => {
    h.getTenantRouting.mockResolvedValue(ok({ routing }));
    await run('domain', 'show');
    expect(logSpy).toHaveBeenCalledWith([
      'workspace.example.org',
      'courses.example.org\tpending-dns',
      'CNAME\tcourses.example.org\trouting.example.org\tpending',
      'TXT\t_vercel.courses.example.org\tchallenge\tverified',
    ].join('\n'));
  });
});

describe('tenant accent settings', () => {
  it('sends both accents and clears only the light override', async () => {
    h.updateTenantSettings.mockResolvedValue(ok({ settings: { accentColor: '#F5C842', accentLight: '#786000' } }));
    await run('--json', 'tenant', 'settings-set', '--accent-color', '#F5C842', '--accent-light', '#786000');
    expect(h.updateTenantSettings).toHaveBeenLastCalledWith({ accentColor: '#F5C842', accentLight: '#786000' });
    await run('--json', 'tenant', 'settings-set', '--clear-accent-light');
    expect(h.updateTenantSettings).toHaveBeenLastCalledWith({ accentLight: null });
  });

  it('shows both accents in settings output', async () => {
    h.getTenantSettings.mockResolvedValue(ok({ settings: { accentColor: '#F5C842', accentLight: '#786000' } }));
    await run('tenant', 'settings');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('dark accent: #F5C842'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('light accent: #786000'));
  });
});
