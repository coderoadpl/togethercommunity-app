import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { ImpersonationTokenCodec } from '#core/server/index.js';

const TOKEN_PART_COUNT = 3;

/** Keeps these tokens unforgeable from any other artifact signed with the same secret. */
const SIGNING_DOMAIN = 'impersonation-v1';

const sign = (secret: string, payload: string): string =>
  createHmac('sha256', secret).update(`${SIGNING_DOMAIN}|${payload}`).digest('base64url');

const signatureMatches = (expected: string, presented: string): boolean => {
  const expectedBytes = Buffer.from(expected);
  const presentedBytes = Buffer.from(presented);
  return expectedBytes.length === presentedBytes.length
    && timingSafeEqual(expectedBytes, presentedBytes);
};

export const createImpersonationTokenCodec = (secret: string): ImpersonationTokenCodec => ({
  issue: (sessionId) => {
    const nonce = randomBytes(32).toString('base64url');
    const payload = `${sessionId}.${nonce}`;
    return {
      token: `${payload}.${sign(secret, payload)}`,
      tokenHash: createHash('sha256').update(nonce).digest('hex'),
    };
  },
  verify: (token) => {
    const parts = token.split('.');
    if (parts.length !== TOKEN_PART_COUNT) return null;
    const [sessionId, nonce, signature] = parts;
    if (sessionId === undefined || nonce === undefined || signature === undefined) return null;
    if (sessionId.length === 0 || nonce.length === 0) return null;
    if (!signatureMatches(sign(secret, `${sessionId}.${nonce}`), signature)) return null;
    return { sessionId, tokenHash: createHash('sha256').update(nonce).digest('hex') };
  },
});
