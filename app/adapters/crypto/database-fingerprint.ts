import { createHash } from 'node:crypto';

const POSTGRES_DEFAULT_PORT = '5432';

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
  try {
    const { hostname, port, pathname } = new URL(databaseUrl);
    const database = decodeURIComponent(pathname.replace(/^\//, ''));
    if (hostname === '' || database === '') return null;
    return createHash('sha256')
      .update(JSON.stringify([hostname, port === '' ? POSTGRES_DEFAULT_PORT : port, database]))
      .digest('hex').slice(0, 16);
  } catch {
    return null;
  }
};
