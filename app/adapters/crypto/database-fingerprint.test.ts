import { afterEach, describe, expect, it, vi } from 'vitest';
import { databaseConnectionTarget } from '#adapters/db/connection-target.js';
import { DATABASE_IDENTITY_PATTERN } from '#core/domain/index.js';
import { databaseHostFingerprint, databaseIdentityFingerprint } from './database-fingerprint.js';

describe('databaseHostFingerprint', () => {
  it('keeps the host-only values that monitors pin', () => {
    const fingerprint = databaseHostFingerprint('postgres://user:secret@db.example:6432/together');
    expect(fingerprint).toBe('b1bfbb98b4f7');
    expect(databaseHostFingerprint('postgres://db.example/other?host=other.example')).toBe(fingerprint);
    expect(databaseHostFingerprint('postgres://a:b@/together?host=db.example')).toBeNull();
  });
});

describe('databaseIdentityFingerprint', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('distinguishes databases on one server that the host fingerprint cannot tell apart', () => {
    const first = 'postgres://user:secret@db.example:6432/together_one';
    const second = 'postgres://user:secret@db.example:6432/together_two';
    expect(databaseHostFingerprint(first)).toBe(databaseHostFingerprint(second));
    expect(databaseIdentityFingerprint(first)).not.toBe(databaseIdentityFingerprint(second));
    expect(databaseIdentityFingerprint(first)).toMatch(DATABASE_IDENTITY_PATTERN);
  });

  it('distinguishes ports and ignores credentials and query parameters', () => {
    expect(databaseIdentityFingerprint('postgres://a:b@db.example:6432/together'))
      .not.toBe(databaseIdentityFingerprint('postgres://a:b@db.example:6433/together'));
    expect(databaseIdentityFingerprint('postgres://a:b@db.example:6432/together?sslmode=require'))
      .toBe(databaseIdentityFingerprint('postgres://other:credentials@db.example:6432/together'));
  });

  it('treats an omitted port as the PostgreSQL default port', () => {
    expect(databaseIdentityFingerprint('postgres://db.example/together'))
      .toBe(databaseIdentityFingerprint('postgres://db.example:5432/together'));
  });

  it('never contains the connection string or its credentials', () => {
    const identity = databaseIdentityFingerprint('postgres://user:secret@db.example:6432/together');
    expect(identity).not.toContain('secret');
    expect(identity).not.toContain('db.example');
  });

  it('keeps the identity that plain connection URLs had before query parameters were resolved', () => {
    vi.stubEnv('PGPORT', '');
    expect(databaseIdentityFingerprint('postgres://user:secret@db.example:6432/together')).toBe('d1582da28ac495fe');
    expect(databaseIdentityFingerprint('postgres://db.example/together')).toBe('3594b4a19059adae');
  });

  it('follows the port and host that query parameters select for the driver', () => {
    const plain = databaseIdentityFingerprint('postgres://a:b@db.example:5432/together');
    const queryPort = databaseIdentityFingerprint('postgres://a:b@db.example:5432/together?port=5433');
    const queryHost = databaseIdentityFingerprint('postgres://a:b@db.example:5432/together?host=other.example');
    expect(new Set([plain, queryPort, queryHost]).size).toBe(3);
    expect(queryPort).toBe(databaseIdentityFingerprint('postgres://a:b@db.example:5433/together'));
    expect(queryHost).toBe(databaseIdentityFingerprint('postgres://a:b@other.example:5432/together'));
  });

  it('ignores a nested connectionString parameter, as the application pool does', () => {
    const nested = 'connectionString=postgres%3A%2F%2Fx%40shared.example%2Fshared';
    const first = databaseIdentityFingerprint(`postgres://a:b@db.example/together_one?${nested}`);
    const second = databaseIdentityFingerprint(`postgres://a:b@db.example/together_two?${nested}`);
    expect(first).not.toBe(second);
    expect(first).toBe(databaseIdentityFingerprint('postgres://a:b@db.example/together_one'));
    expect(second).toBe(databaseIdentityFingerprint('postgres://a:b@db.example/together_two'));
  });

  it('parses the string after the same SSL mode normalisation as the application pool', () => {
    expect(databaseIdentityFingerprint('postgres://a:b@db.example:6432/together?uselibpqcompat=true&sslmode=verify-ca'))
      .toBe(databaseIdentityFingerprint('postgres://a:b@db.example:6432/together'));
  });

  it('takes the host from the query parameter when the credentialed authority names none', () => {
    vi.stubEnv('PGPORT', '');
    expect(databaseIdentityFingerprint('postgres://a:b@/together?host=db.example')).toBe('3594b4a19059adae');
  });

  it('hashes a percent-encoded database name as the driver decodes it', () => {
    vi.stubEnv('PGPORT', '');
    expect(databaseConnectionTarget('postgres://db.example/caf%C3%A9%20one%2Fx'))
      .toEqual({ host: 'db.example', port: 5432, database: 'café one%2Fx' });
    expect(databaseIdentityFingerprint('postgres://db.example/caf%C3%A9%20one%2Fx')).toBe('469048da1ef814fe');
  });

  it('follows the driver for an unnamed port, PGPORT included', () => {
    vi.stubEnv('PGPORT', '6543');
    expect(databaseIdentityFingerprint('postgres://db.example/together'))
      .toBe(databaseIdentityFingerprint('postgres://db.example:6543/together'));
  });

  it('never reports a host or database that only the process environment supplies', () => {
    vi.stubEnv('PGHOST', 'env-host.example');
    vi.stubEnv('PGDATABASE', 'env_database');
    expect(databaseIdentityFingerprint('postgres://a:b@/together')).toBeNull();
    expect(databaseIdentityFingerprint('postgres://a:b@db.example')).toBeNull();
    expect(process.env['PGHOST']).toBe('env-host.example');
    expect(process.env['PGDATABASE']).toBe('env_database');
  });

  it('lets no credential reach the result, a warning or the console', () => {
    const emitWarning = vi.spyOn(process, 'emitWarning');
    const consoleCalls = (['log', 'info', 'warn', 'error', 'debug'] as const)
      .map((method) => vi.spyOn(console, method));
    const connectionStrings = [
      'postgres://user:hunter2-secret@db.example:6432/together?sslmode=require&password=hunter2-secret',
      'postgres://user:hunter2-secret@db.example/together?uselibpqcompat=true&sslmode=verify-ca',
      'postgres://user:hunter2-secret@db.example/together?sslrootcert=/nonexistent/hunter2-secret',
      'postgres://user:hunter2-secret@db.example:not-a-port/together',
    ];
    const results = connectionStrings.map((value) => [databaseConnectionTarget(value), databaseIdentityFingerprint(value)]);
    expect(JSON.stringify(results)).not.toContain('hunter2');
    expect(emitWarning).not.toHaveBeenCalled();
    for (const spy of consoleCalls) expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    'postgres:///together',
    'postgres://db.example:6432/',
    'postgres://a:b@/together',
    'postgres://user@db.example',
    'postgres:together',
    'not a url',
    'postgres://user@%2Fvar%2Frun%2Fpostgresql/together',
    'postgres://user@db.example/together?host=/var/run/postgresql',
    'socket:/var/run/postgresql?db=together',
    '/var/run/postgresql together',
  ])('reports no identity for %s', (url) => {
    expect(databaseIdentityFingerprint(url)).toBeNull();
  });
});
