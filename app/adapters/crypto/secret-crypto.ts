import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { err, internal, ok, type Result, type AppError } from '@core/domain/index.js';
import type { SecretCrypto } from '@core/server/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * AES-256-GCM at-rest encryption for tenant BYO secrets (FR-10). The 256-bit
 * master key is supplied by the composition root from `SECRETS_MASTER_KEY`; a
 * fresh random IV per encryption keeps identical plaintexts distinct, and the
 * GCM auth tag makes any ciphertext/IV tampering fail closed on decrypt.
 */
export const createSecretCrypto = (masterKeyBase64: string): SecretCrypto => {
  const key = Buffer.from(masterKeyBase64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`SECRETS_MASTER_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`);
  }

  return {
    encrypt: (plaintext) => {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return {
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
      };
    },
    decrypt: (input): Result<string, AppError> => {
      try {
        const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(input.iv, 'base64'));
        decipher.setAuthTag(Buffer.from(input.authTag, 'base64'));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(input.ciphertext, 'base64')),
          decipher.final(),
        ]);
        return ok(plaintext.toString('utf8'));
      } catch {
        return err(internal('Stored secret failed integrity verification'));
      }
    },
  };
};
