import { createHmac } from 'node:crypto';

import { normalizeEmail } from '#core/domain/index.js';
import type { EmailHmac } from '#core/server/index.js';

export const createEmailHmac = (masterKeyBase64: string): EmailHmac => {
  const key = Buffer.from(masterKeyBase64, 'base64');
  if (key.length !== 32) throw new Error('SECRETS_MASTER_KEY must decode to exactly 32 bytes');
  return {
    compute: (tenantId, email) => createHmac('sha256', key)
      .update(tenantId)
      .update('\0')
      .update(normalizeEmail(email))
      .digest('hex'),
  };
};
