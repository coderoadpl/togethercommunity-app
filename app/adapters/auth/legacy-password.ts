import { pbkdf2, pbkdf2Sync, timingSafeEqual } from 'node:crypto';

import { verifyPassword as verifyDefaultPassword } from 'better-auth/crypto';

const PAYLOAD_PBKDF2_MARKER = 'payload-pbkdf2';
const PAYLOAD_ITERATIONS = 25000;
const PAYLOAD_KEYLEN = 512;
const PAYLOAD_DIGEST = 'sha256';

interface LegacyCredential {
  salt: string;
  hash: string;
}

export const toLegacyPasswordHash = ({ salt, hash }: LegacyCredential): string =>
  `${PAYLOAD_PBKDF2_MARKER}$${salt}$${hash}`;

export const isLegacyPasswordHash = (stored: string): boolean =>
  stored.startsWith(`${PAYLOAD_PBKDF2_MARKER}$`);

export const deriveLegacyPasswordHash = (password: string, salt: string): string =>
  toLegacyPasswordHash({
    salt,
    hash: pbkdf2Sync(password, salt, PAYLOAD_ITERATIONS, PAYLOAD_KEYLEN, PAYLOAD_DIGEST).toString(
      'hex',
    ),
  });

const parseLegacyCredential = (stored: string): LegacyCredential | null => {
  const parts = stored.split('$');
  if (parts.length !== 3) return null;
  const [marker, salt, hash] = parts;
  if (marker !== PAYLOAD_PBKDF2_MARKER || !salt || !hash) return null;
  return { salt, hash };
};

const derivePayloadHash = (password: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    // Payload feeds the hex salt string straight into pbkdf2 (its utf8 bytes),
    // not the decoded salt bytes; stored hashes only match if we do the same.
    pbkdf2(password, salt, PAYLOAD_ITERATIONS, PAYLOAD_KEYLEN, PAYLOAD_DIGEST, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });

const verifyLegacyPassword = async (
  credential: LegacyCredential,
  password: string,
): Promise<boolean> => {
  const expected = Buffer.from(credential.hash, 'hex');
  if (expected.length !== PAYLOAD_KEYLEN) return false;
  const derived = await derivePayloadHash(password, credential.salt);
  return timingSafeEqual(derived, expected);
};

export const verifyPasswordWithLegacyFallback = async ({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> => {
  const legacy = parseLegacyCredential(hash);
  if (legacy) return verifyLegacyPassword(legacy, password);
  return verifyDefaultPassword({ hash, password });
};
