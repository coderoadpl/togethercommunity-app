import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createImpersonationTokenCodec } from './impersonation-token-codec.js';

const SECRET = 'unit-test-signing-secret';
const codec = createImpersonationTokenCodec(SECRET);

describe('impersonation token codec', () => {
  it('round-trips a session id and derives a stable hash of the nonce alone', () => {
    const issued = codec.issue('session-1');
    expect(issued.token).not.toContain(issued.tokenHash);
    expect(codec.verify(issued.token)).toEqual({
      sessionId: 'session-1',
      tokenHash: issued.tokenHash,
    });
  });

  it('issues a distinct nonce per call so two views never share a hash', () => {
    expect(codec.issue('session-1').tokenHash).not.toBe(codec.issue('session-1').tokenHash);
  });

  it('refuses a malformed, retargeted, or foreign-key token', () => {
    const issued = codec.issue('session-1');
    const [sessionId, nonce, signature] = issued.token.split('.');

    expect(codec.verify('nonsense')).toBeNull();
    expect(codec.verify(`${sessionId ?? ''}.${nonce ?? ''}`)).toBeNull();
    expect(codec.verify(`session-2.${nonce ?? ''}.${signature ?? ''}`)).toBeNull();
    expect(codec.verify(`${sessionId ?? ''}.${nonce ?? ''}.tampered`)).toBeNull();
    expect(createImpersonationTokenCodec('another-secret').verify(issued.token)).toBeNull();
  });

  it('refuses a signature taken over the bare payload under the shared secret', () => {
    const payload = 'session-1.nonce-1';
    const undomained = createHmac('sha256', SECRET).update(payload).digest('base64url');

    expect(codec.verify(`${payload}.${undomained}`)).toBeNull();
  });
});
