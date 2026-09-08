type DatabaseEnvironment = Readonly<{
  E2E_DATABASE_URL?: string;
  DATABASE_URL?: string;
  E2E_ALLOW_REMOTE_DATABASE_RESET?: string;
}>;

const defaultDatabaseUrl = 'postgres://together:together@localhost:48912/together';
const localDatabaseHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', 'postgres']);
const destructiveDatabaseNamePattern = /(^|_)(e2e|test)(_|$)/;
const enabledValues = new Set(['1', 'true', 'yes']);

export const resolveE2eDatabaseUrl = (environment: DatabaseEnvironment): string =>
  environment.E2E_DATABASE_URL ?? environment.DATABASE_URL ?? defaultDatabaseUrl;

export const assertSafeE2eDatabaseReset = (
  baseDatabaseUrl: string,
  targetDatabaseName: string,
  environment: DatabaseEnvironment,
): void => {
  let target: URL;
  try {
    target = new URL(baseDatabaseUrl);
  } catch {
    throw new Error('Refusing to reset the E2E database: the resolved database URL is invalid');
  }

  if (!destructiveDatabaseNamePattern.test(targetDatabaseName)) {
    throw new Error(
      `Refusing to reset E2E database "${targetDatabaseName}": the target database name must include "e2e" or "test"`,
    );
  }

  const remoteResetAllowed = enabledValues.has(
    environment.E2E_ALLOW_REMOTE_DATABASE_RESET?.toLowerCase() ?? '',
  );
  if (!localDatabaseHosts.has(target.hostname) && !remoteResetAllowed) {
    throw new Error(
      `Refusing to reset E2E database "${targetDatabaseName}" on host "${target.hostname}": set E2E_ALLOW_REMOTE_DATABASE_RESET=true only for a disposable CI database server`,
    );
  }
};
