import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_IDENTITY_PATTERN } from '#core/domain/index.js';
import { databaseHostFingerprint, databaseIdentityFingerprint } from './database-fingerprint.js';

describe('databaseIdentityFingerprint', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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

  it.each([
    'postgres:///together',
    'postgres://db.example:6432/',
    'not a url',
    'postgres://user@%2Fvar%2Frun%2Fpostgresql/together',
    'postgres://user@db.example/together?host=/var/run/postgresql',
    'socket:/var/run/postgresql?db=together',
    '/var/run/postgresql together',
  ])('reports no identity for %s', (url) => {
    expect(databaseIdentityFingerprint(url)).toBeNull();
  });
});
