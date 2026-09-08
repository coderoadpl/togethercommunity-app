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
  listCourses: ReturnType<typeof vi.fn>;
  listModules: ReturnType<typeof vi.fn>;
  listLessons: ReturnType<typeof vi.fn>;
  updateLesson: ReturnType<typeof vi.fn>;
  health: ReturnType<typeof vi.fn>;
  configureStorage: ReturnType<typeof vi.fn>;
  changePassword: ReturnType<typeof vi.fn>;
  requestPasswordReset: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  signIn: ReturnType<typeof vi.fn>;
  verifyTotp: ReturnType<typeof vi.fn>;
  verifyBackupCode: ReturnType<typeof vi.fn>;
  configureStripe: ReturnType<typeof vi.fn>;
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
    listCourses: vi.fn(),
    listModules: vi.fn(),
    listLessons: vi.fn(),
    updateLesson: vi.fn(),
    health: vi.fn(),
    configureStorage: vi.fn(),
    changePassword: vi.fn(),
    requestPasswordReset: vi.fn(),
    signOut: vi.fn(),
    signIn: vi.fn(),
    verifyTotp: vi.fn(),
    verifyBackupCode: vi.fn(),
    configureStripe: vi.fn(),
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

vi.mock('#core/client/index.js', () => ({
  createApiClient: () => ({
    listCourses: h.listCourses,
    listModules: h.listModules,
    listLessons: h.listLessons,
    updateLesson: h.updateLesson,
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
  h.listCourses.mockReset();
  h.listModules.mockReset();
  h.listLessons.mockReset();
  h.updateLesson.mockReset();
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

describe('lesson preview commands', () => {
  const previewLesson = (id: string, isPreview = false) => ({
    id, name: `Lesson ${id}`, isPreview, contents: [],
  });
  const previewModule = (id: string, chapters: string[][], courseIds = ['course-1']) => ({
    id, name: `Module ${id}`, courseIds, createdAt: '2026-09-01T00:00:00.000Z',
    chapters: chapters.map((ids, index) => ({ id: `chapter-${index}`, name: `Chapter ${index}`,
      contents: ids.map((lessonId) => ({ id: lessonId, name: lessonId, lessonId })),
    })),
  });
  const select = (...args: string[]) => run('--json', 'lesson', 'preview', 'set', '--course', 'course-1', ...args);

  beforeEach(() => {
    h.listCourses.mockResolvedValue(ok({ courses: [{ id: 'course-1', moduleOrder: ['module-2', 'module-1'] }] }));
    h.listModules.mockResolvedValue(ok({ modules: [
      previewModule('module-1', [[], ['one', 'two'], ['three']]),
      previewModule('module-2', [['two', 'four', 'two']]),
      previewModule('empty', [[]]),
      previewModule('unrelated', [['outside']], ['course-2']),
    ] }));
    h.listLessons.mockResolvedValue(ok({ lessons: [
      previewLesson('one'), previewLesson('two', true), previewLesson('three', true),
      previewLesson('four'), previewLesson('outside', true),
    ] }));
    h.updateLesson.mockImplementation((input: { id: string; isPreview?: boolean }) =>
      Promise.resolve(ok({ lesson: previewLesson(input.id, input.isPreview) })));
  });

  it.each([
    { flags: ['--preview'], payload: { id: 'one', isPreview: false }, expected: { id: 'one', isPreview: true } },
    { flags: ['--no-preview'], payload: { id: 'one', isPreview: true }, expected: { id: 'one', isPreview: false } },
    { flags: [], payload: { id: 'one', name: 'Renamed' }, expected: { id: 'one', name: 'Renamed' } },
    { flags: [], payload: { id: 'one', isPreview: true }, expected: { id: 'one', isPreview: true } },
  ])('updates a lesson with $flags and preserves omitted preview state', async ({ flags, payload, expected }) => {
    await run('--json', 'lesson', 'update', '--data', JSON.stringify(payload), ...flags);
    expect(h.updateLesson).toHaveBeenCalledExactlyOnceWith(expected);
    expect(soleJson()).toMatchObject({ ok: true, data: { lesson: { id: 'one' } } });
    expect(process.exitCode).toBe(0);
  });

  it('rejects an invalid update before calling the client', async () => {
    await run('--json', 'lesson', 'update', '--data', '{}', '--preview');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.updateLesson).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });

  it('preserves update error taxonomy', async () => {
    h.updateLesson.mockResolvedValue(err(appError('forbidden', 'Staff only')));
    await run('--json', 'lesson', 'update', '--data', '{"id":"one"}', '--preview');
    expect(soleJson()).toEqual({ ok: false, error: { code: 'forbidden', message: 'Staff only' } });
    expect(process.exitCode).toBe(4);
  });

  it('selects the first lesson across chapters per module and disables other previews', async () => {
    await select('--first-per-module');
    expect(h.updateLesson.mock.calls).toEqual([[{ id: 'one', isPreview: true }], [{ id: 'three', isPreview: false }]]);
    expect(soleJson()).toMatchObject({ ok: true, data: {
      changedLessonCount: 2, updatedLessonIds: ['one', 'three'],
      lessons: [
        { moduleId: 'module-2', lessonId: 'two', isPreview: true },
        { moduleId: 'module-2', lessonId: 'four', isPreview: false },
        { moduleId: 'module-1', lessonId: 'one', isPreview: true },
        { moduleId: 'module-1', lessonId: 'two', isPreview: true },
        { moduleId: 'module-1', lessonId: 'three', isPreview: false },
      ],
    } });
  });

  it('replaces the selection with trimmed and deduplicated explicit IDs', async () => {
    await select('--lessons', ' four, four ');
    expect(h.updateLesson.mock.calls).toEqual([
      [{ id: 'two', isPreview: false }], [{ id: 'four', isPreview: true }], [{ id: 'three', isPreview: false }],
    ]);
    expect(soleJson()).toMatchObject({ ok: true, data: { changedLessonCount: 3 } });
  });

  it.each([
    { mode: '--all', updates: [{ id: 'four', isPreview: true }, { id: 'one', isPreview: true }] },
    { mode: '--none', updates: [{ id: 'two', isPreview: false }, { id: 'three', isPreview: false }] },
  ])('applies $mode once per changed lesson', async ({ mode, updates }) => {
    await select(mode);
    expect(h.updateLesson.mock.calls).toEqual(updates.map((update) => [update]));
    expect(soleJson()).toMatchObject({ ok: true, data: { changedLessonCount: 2 } });
  });

  it('does not write during a dry run and emits one JSON plan', async () => {
    await select('--all', '--dry-run');
    expect(h.updateLesson).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: true, data: { dryRun: true, changedLessonCount: 2, updatedLessonIds: [] } });
  });

  it('prints the human table before writing', async () => {
    h.updateLesson.mockImplementation((input: { id: string; isPreview: boolean }) => {
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Module\tLesson\tCurrent -> new'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Lesson four (four)\tfalse -> true'));
      return Promise.resolve(ok({ lesson: previewLesson(input.id, input.isPreview) }));
    });
    await run('lesson', 'preview', 'set', '--course', 'course-1', '--all');
    expect(logSpy).toHaveBeenLastCalledWith('updated 2 lesson(s)');
    expect(h.updateLesson).toHaveBeenCalledTimes(2);
  });

  it('is idempotent when the command is repeated', async () => {
    const lessons = [previewLesson('one'), previewLesson('two'), previewLesson('three'), previewLesson('four')];
    h.listLessons.mockResolvedValue(ok({ lessons }));
    h.updateLesson.mockImplementation((input: { id: string; isPreview: boolean }) => {
      const lesson = lessons.find((item) => item.id === input.id);
      if (lesson === undefined) throw new Error('Unexpected lesson');
      lesson.isPreview = input.isPreview;
      return Promise.resolve(ok({ lesson }));
    });
    await select('--all');
    expect(h.updateLesson).toHaveBeenCalledTimes(4);
    h.updateLesson.mockClear();
    logSpy.mockClear();
    await select('--all');
    expect(h.updateLesson).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: true, data: { changedLessonCount: 0, updatedLessonIds: [] } });
  });

  it.each([[], ['--all', '--none'], ['--first-per-module', '--lessons', 'one'], ['--lessons', 'one,,two']])(
    'rejects invalid selection %j before fetching', async (...args) => {
      await select(...args);
      expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
      expect(h.listCourses).not.toHaveBeenCalled();
      expect(h.updateLesson).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(2);
    },
  );

  it('rejects an ID outside the course before making changes', async () => {
    await select('--lessons', 'one,outside');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('outside') } });
    expect(h.updateLesson).not.toHaveBeenCalled();
  });

  it('rejects broken lesson references before making changes', async () => {
    h.listLessons.mockResolvedValue(ok({ lessons: [] }));
    await select('--all');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.updateLesson).not.toHaveBeenCalled();
  });

  it('handles empty courses without writes', async () => {
    h.listModules.mockResolvedValue(ok({ modules: [] }));
    await select('--first-per-module');
    expect(soleJson()).toMatchObject({ ok: true, data: { lessons: [], changedLessonCount: 0 } });
    expect(h.updateLesson).not.toHaveBeenCalled();
  });

  it('reports a missing course', async () => {
    h.listCourses.mockResolvedValue(ok({ courses: [] }));
    await select('--none');
    expect(soleJson()).toEqual({ ok: false, error: { code: 'not_found', message: 'Course not found' } });
    expect(process.exitCode).toBe(5);
    expect(h.listModules).not.toHaveBeenCalled();
  });

  it.each(['listCourses', 'listModules', 'listLessons'] as const)('propagates %s failures without writes', async (method) => {
    h[method].mockResolvedValue(err(appError('unauthorized', 'Sign in')));
    await select('--all');
    expect(soleJson()).toEqual({ ok: false, error: { code: 'unauthorized', message: 'Sign in' } });
    expect(process.exitCode).toBe(3);
    expect(h.updateLesson).not.toHaveBeenCalled();
  });

  it('stops after a write failure and reports completed updates in one error envelope', async () => {
    h.updateLesson.mockResolvedValueOnce(ok({ lesson: previewLesson('two') }))
      .mockResolvedValueOnce(err(appError('conflict', 'Concurrent update')));
    await select('--lessons', 'four');
    expect(h.updateLesson).toHaveBeenCalledTimes(2);
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'conflict',
      details: { failedLessonId: 'four', updatedLessonIds: ['two'] },
    } });
    expect(process.exitCode).toBe(6);
  });
});
