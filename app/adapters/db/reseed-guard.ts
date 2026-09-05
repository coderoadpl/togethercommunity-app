import { databaseHostFingerprint } from '#adapters/crypto/database-fingerprint.js';
import {
  isProductionDeployment,
  isProductionEnvironment,
  productionResetRefusal,
  type DeploymentIdentityEnv,
  type DeploymentResetMarkers,
} from '#core/domain/index.js';

export interface ReseedEnv {
  NODE_ENV?: string | undefined;
  APP_ENV?: string | undefined;
  DATABASE_URL: string;
  PRODUCTION_DATABASE_FINGERPRINT?: string | undefined;
}

export interface DeploymentEnv extends ReseedEnv, DeploymentIdentityEnv {}

export const reseedMarkers = (env: ReseedEnv): DeploymentResetMarkers => ({
  production: isProductionEnvironment(env),
  databaseFingerprint: databaseHostFingerprint(env.DATABASE_URL),
  productionDatabaseFingerprint: env.PRODUCTION_DATABASE_FINGERPRINT ?? null,
});

export const deploymentMarkers = (env: DeploymentEnv): DeploymentResetMarkers => ({
  production: isProductionDeployment(env),
  databaseFingerprint: databaseHostFingerprint(env.DATABASE_URL),
  productionDatabaseFingerprint: env.PRODUCTION_DATABASE_FINGERPRINT ?? null,
});

export const assertReseedAllowed = (markers: DeploymentResetMarkers): void => {
  const refusal = productionResetRefusal(markers);
  if (refusal !== null) throw new Error(`Reseed refused because ${refusal}`);
};
