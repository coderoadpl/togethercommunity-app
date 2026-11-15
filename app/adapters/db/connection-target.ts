import ConnectionParameters from 'pg/lib/connection-parameters';

export type DatabaseConnectionTarget = {
  readonly host: string;
  readonly port: number;
  readonly database: string;
};

// The driver fills a host or database the string leaves out from PGHOST, PGDATABASE or the user name,
// which describes the process environment rather than the configured server.
const namesHostAndDatabase = (connectionString: string): boolean => {
  const url = new URL(connectionString);
  const queryHost = url.searchParams.get('host') ?? '';
  return (queryHost !== '' || url.hostname !== '') && url.pathname !== '' && url.pathname !== '/';
};

export const databaseConnectionTarget = (connectionString: string): DatabaseConnectionTarget | null => {
  try {
    if (!namesHostAndDatabase(connectionString)) return null;
    const { host, port, database } = new ConnectionParameters(connectionString);
    if (host === undefined || host === '' || host.startsWith('/')) return null;
    if (database === undefined || database === '') return null;
    if (port === undefined || !Number.isInteger(port)) return null;
    return { host, port, database };
  } catch {
    return null;
  }
};
