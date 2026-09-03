import { createHash } from 'node:crypto';

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
