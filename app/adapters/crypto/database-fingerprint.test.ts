import { describe, expect, it } from 'vitest';
import { DATABASE_IDENTITY_PATTERN } from '#core/domain/index.js';
import { databaseHostFingerprint, databaseIdentityFingerprint } from './database-fingerprint.js';

describe('databaseIdentityFingerprint', () => {
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

  it.each(['postgres:///together', 'postgres://db.example:6432/', 'not a url'])('reports no identity for %s', (url) => {
    expect(databaseIdentityFingerprint(url)).toBeNull();
  });
});
