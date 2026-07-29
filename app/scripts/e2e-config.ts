type DatabaseEnvironment = Readonly<{
  E2E_DATABASE_URL?: string;
  DATABASE_URL?: string;
}>;

const defaultDatabaseUrl = 'postgres://together:together@localhost:48912/together';

export const resolveE2eDatabaseUrl = (environment: DatabaseEnvironment): string =>
  environment.E2E_DATABASE_URL ?? environment.DATABASE_URL ?? defaultDatabaseUrl;
