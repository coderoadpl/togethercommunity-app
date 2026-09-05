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

export interface DeploymentIdentityEnv {
  NODE_ENV?: string | undefined;
  APP_ENV?: string | undefined;
  VERCEL_ENV?: string | undefined;
  VERCEL?: string | undefined;
  VERCEL_URL?: string | undefined;
}

const buildsOnVercel = (env: DeploymentIdentityEnv): boolean =>
  env.VERCEL !== undefined || env.VERCEL_URL !== undefined;

/**
 * `VERCEL_ENV` names the deployment slot the platform built, `APP_ENV` names the
 * posture the app boots with, and a deployment is production only when both
 * agree. On Vercel an absent `VERCEL_ENV` is a misconfigured slot rather than a
 * production one, so it downgrades to non-production; off Vercel (self-host,
 * local build) there is no slot to name and the app posture decides alone.
 */
export const isProductionDeployment = (env: DeploymentIdentityEnv): boolean =>
  (env.VERCEL_ENV === undefined ? !buildsOnVercel(env) : env.VERCEL_ENV === 'production')
  && isProductionEnvironment(env);

export const unnamedDeploymentSlotWarning = (env: DeploymentIdentityEnv): string | null => {
  if (env.VERCEL_ENV !== undefined) return null;
  return buildsOnVercel(env)
    ? 'VERCEL_ENV is absent on a Vercel build, so this deployment is treated as non-production'
    : 'VERCEL_ENV is absent, so the deployment posture is taken from APP_ENV and NODE_ENV alone';
};

export interface DeploymentResetMarkers {
  production: boolean;
  databaseFingerprint: string | null;
  productionDatabaseFingerprint: string | null;
}

export type DeploymentDatabaseVerdict =
  | { decision: 'allowed' }
  | { decision: 'warned'; message: string }
  | { decision: 'refused'; message: string };

export const deploymentDatabaseVerdict = (
  markers: DeploymentResetMarkers,
): DeploymentDatabaseVerdict => {
  if (markers.production) return { decision: 'allowed' };
  if (markers.productionDatabaseFingerprint === null) {
    return {
      decision: 'warned',
      message:
        'PRODUCTION_DATABASE_FINGERPRINT is unset, so this non-production deployment cannot tell whether DATABASE_URL is the production database',
    };
  }
  return markers.databaseFingerprint === markers.productionDatabaseFingerprint
    ? {
        decision: 'refused',
        message:
          'this deployment is not production but DATABASE_URL is the production database',
      }
    : { decision: 'allowed' };
};

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
