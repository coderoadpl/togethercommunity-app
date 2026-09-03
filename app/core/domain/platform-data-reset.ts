/**
 * Environments whose data is disposable. Production is never listed, so the
 * reset surface has no code path that can reach a production deployment.
 */
const RESETTABLE_ENVIRONMENTS = ['staging', 'preview'] as const;

export type ResettableEnvironment = (typeof RESETTABLE_ENVIRONMENTS)[number];

export const resettableEnvironment = (
  appEnv: string | undefined,
): ResettableEnvironment | null =>
  RESETTABLE_ENVIRONMENTS.find((candidate) => candidate === appEnv) ?? null;

/**
 * Vercel sets `NODE_ENV=production` on Preview deployments as well, so
 * `NODE_ENV` alone cannot separate a preview from production. Only an
 * explicitly named disposable `APP_ENV` opts out; anything unrecognised keeps
 * the strict production posture.
 */
export const isProductionEnvironment = (
  env: { NODE_ENV?: string | undefined; APP_ENV?: string | undefined },
): boolean =>
  env.APP_ENV === 'production'
  || (env.NODE_ENV === 'production' && resettableEnvironment(env.APP_ENV) === null);

export interface DeploymentResetMarkers {
  production: boolean;
  databaseFingerprint: string | null;
  productionDatabaseFingerprint: string | null;
}

export const productionResetRefusal = (markers: DeploymentResetMarkers): string | null => {
  if (markers.production) return 'the deployment identity reports production';
  if (
    markers.productionDatabaseFingerprint !== null
    && markers.databaseFingerprint === markers.productionDatabaseFingerprint
  ) return 'the database fingerprint matches the production database';
  return null;
};

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const parsePlatformOwnerEmails = (raw: string | undefined): readonly string[] =>
  raw === undefined
    ? []
    : [...new Set(raw.split(',').map(normalizeEmail).filter((email) => email.length > 0))];

export const isPlatformOwner = (email: string, owners: readonly string[]): boolean =>
  owners.includes(normalizeEmail(email));

export interface PlatformAuditEvent {
  id: string;
  action: 'platform:data-reset';
  actorUserId: string;
  actorEmail: string;
  environment: string;
  status: 'succeeded' | 'failed';
  detail: string | null;
  durationMs: number;
  createdAt: string;
}

export interface WipedTable {
  table: string;
  rows: number;
}
