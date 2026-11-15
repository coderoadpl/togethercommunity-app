import type { ClientConfig } from 'pg';
import ConnectionParameters from 'pg/lib/connection-parameters';

import { normalizeDatabaseConnectionString } from './client.js';

export type DatabaseConnectionTarget = {
  readonly host: string;
  readonly port: number;
  readonly database: string;
};

const UNNAMED = '<together-connection-value-not-named-by-the-string>';
const ENVIRONMENT_FALLBACKS = ['PGHOST', 'PGDATABASE'] as const;

// The driver's parser resolves a string without a scheme against a placeholder base URL, so the host it
// reports for such a string is the placeholder's rather than one the string names.
const hasScheme = (connectionString: string): boolean => /^[a-z][a-z\d+.-]*:/i.test(connectionString);

// The driver fills a host or database the string leaves out from PGHOST, PGDATABASE, the user name or
// localhost. A sentinel in those variables tells such a value apart from one the string names without
// reimplementing the parser; the parse is synchronous, so no other code observes the swapped variables.
const parseWithSentinelFallbacks = (connectionString: string): ConnectionParameters => {
  const saved = ENVIRONMENT_FALLBACKS.map((name) => [name, process.env[name]] as const);
  try {
    for (const name of ENVIRONMENT_FALLBACKS) process.env[name] = UNNAMED;
    const config: ClientConfig = { connectionString: normalizeDatabaseConnectionString(connectionString) };
    return new ConnectionParameters(config);
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
  }
};

const isNamedValue = (value: string | undefined): value is string =>
  value !== undefined && value !== '' && value !== UNNAMED;

export const databaseConnectionTarget = (connectionString: string): DatabaseConnectionTarget | null => {
  if (!hasScheme(connectionString)) return null;
  try {
    const { host, port, database } = parseWithSentinelFallbacks(connectionString);
    if (!isNamedValue(host) || host.startsWith('/')) return null;
    if (!isNamedValue(database)) return null;
    if (port === undefined || !Number.isInteger(port)) return null;
    return { host, port, database };
  } catch {
    return null;
  }
};
