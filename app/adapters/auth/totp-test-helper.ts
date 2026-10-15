import { createHmac } from 'node:crypto';

export const totpCode = (secret: string): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of secret.toUpperCase().replace(/=+$/u, '')) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error('Invalid base32 secret');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', bytes).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary = ((digest[offset] ?? 0) & 0x7f) << 24 |
    (digest[offset + 1] ?? 0) << 16 |
    (digest[offset + 2] ?? 0) << 8 |
    (digest[offset + 3] ?? 0);
  return (binary % 1_000_000).toString().padStart(6, '0');
};
