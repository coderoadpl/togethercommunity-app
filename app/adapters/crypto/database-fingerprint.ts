import { createHash } from 'node:crypto';

import { databaseConnectionTarget } from '#adapters/db/connection-target.js';

export const databaseHostFingerprint = (databaseUrl: string): string | null => {
  try {
    const { hostname } = new URL(databaseUrl);
    return hostname === ''
      ? null
      : createHash('sha256').update(hostname).digest('hex').slice(0, 12);
  } catch {
    return null;
  }
};

export const databaseIdentityFingerprint = (databaseUrl: string): string | null => {
  const target = databaseConnectionTarget(databaseUrl);
  if (target === null) return null;
  return createHash('sha256')
    .update(JSON.stringify([target.host, String(target.port), target.database]))
    .digest('hex').slice(0, 16);
};
