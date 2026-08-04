import { pbkdf2, pbkdf2Sync, timingSafeEqual } from 'node:crypto';

import { verifyPassword as verifyDefaultPassword } from 'better-auth/crypto';

const PAYLOAD_PBKDF2_MARKER = 'pbkdf2';
const PAYLOAD_PBKDF2_ITERATIONS = 25000;
const PAYLOAD_KEYLEN = 512;
const PAYLOAD_DIGEST = 'sha256';
const PAYLOAD_SALT_PATTERN = /^[0-9a-f]{64}$/iu;
const PAYLOAD_HASH_PATTERN = /^[0-9a-f]{1024}$/iu;

interface LegacyCredential {
  salt: string;
  hash: string;
}

export const isPayloadLegacyCredential = ({ salt, hash }: LegacyCredential): boolean =>
  PAYLOAD_SALT_PATTERN.test(salt) && PAYLOAD_HASH_PATTERN.test(hash);

export const toLegacyPasswordHash = ({ salt, hash }: LegacyCredential): string =>
  `${PAYLOAD_PBKDF2_MARKER}$${String(PAYLOAD_PBKDF2_ITERATIONS)}$${salt}$${hash}`;

export const isLegacyPasswordHash = (stored: string): boolean =>
  stored.startsWith(`${PAYLOAD_PBKDF2_MARKER}$`);

export const deriveLegacyPasswordHash = (password: string, salt: string): string =>
  toLegacyPasswordHash({
    salt,
    hash: pbkdf2Sync(
      password,
      salt,
      PAYLOAD_PBKDF2_ITERATIONS,
      PAYLOAD_KEYLEN,
      PAYLOAD_DIGEST,
    ).toString('hex'),
  });

const parseLegacyCredential = (stored: string): LegacyCredential | null => {
  const parts = stored.split('$');
  if (parts.length !== 4) return null;
  const [marker, iterations, salt, hash] = parts;
  if (
    marker !== PAYLOAD_PBKDF2_MARKER ||
    iterations !== String(PAYLOAD_PBKDF2_ITERATIONS) ||
    salt === undefined ||
    hash === undefined ||
    !PAYLOAD_SALT_PATTERN.test(salt) ||
    !PAYLOAD_HASH_PATTERN.test(hash)
  ) {
    return null;
  }
  return { salt, hash };
};

const derivePayloadHash = (password: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    pbkdf2(
      password,
      salt,
      PAYLOAD_PBKDF2_ITERATIONS,
      PAYLOAD_KEYLEN,
      PAYLOAD_DIGEST,
      (error, derived) => {
        if (error) reject(error);
        else resolve(derived);
      },
    );
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
  if (isLegacyPasswordHash(hash)) {
    const legacy = parseLegacyCredential(hash);
    return legacy === null ? false : verifyLegacyPassword(legacy, password);
  }
  return verifyDefaultPassword({ hash, password });
};
