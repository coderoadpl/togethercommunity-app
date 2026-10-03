import { createHash, randomBytes } from 'node:crypto';

import type { DownloadCopyCrypto } from '#core/server/index.js';

export const createDownloadCopyCrypto = (): DownloadCopyCrypto => ({
  identifier: () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    let encoded = '';
    for (const byte of randomBytes(16)) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        encoded += alphabet[(value >>> bits) & 31];
      }
    }
    if (bits > 0) encoded += alphabet[(value << (5 - bits)) & 31];
    return `copy_${encoded}`;
  },
  hash: (bytes) => createHash('sha256').update(bytes).digest('hex'),
});
