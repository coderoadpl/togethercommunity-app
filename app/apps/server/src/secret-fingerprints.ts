import type { Hono } from 'hono';

import { secretFingerprint } from '#adapters/crypto/secret-fingerprint.js';
import { API_PATHS, SCHEDULER_OPERATOR_SECRET_HEADER, type SecretFingerprint } from '#core/contract/index.js';
import { err, ok, unauthorized } from '#core/domain/index.js';

import type { AppVars } from './app-vars.js';
import type { Env } from './env.js';
import { respond } from './respond.js';
import { secretEquals } from './secret-equals.js';

export const FINGERPRINTED_SECRET_NAMES = [
  'BETTER_AUTH_SECRET',
  'SECRETS_MASTER_KEY',
  'EMAIL_DISPATCH_SECRET',
  'MARKETING_TICK_SECRET',
  'CRON_SECRET',
  'OPERATOR_SECRET',
  'PROD_OPERATOR_SECRET',
  'STAGING_OPERATOR_SECRET',
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'REALTIME_DATABASE_URL',
  'DOMAIN_PROVISIONER_TOKEN',
  'SMTP_PASSWORD',
  'GOOGLE_CLIENT_SECRET',
  'SMOKE_MEMBER_PASSWORD',
  'SMOKE_CREATOR_PASSWORD',
] as const satisfies readonly (keyof Env)[];

type FingerprintedSecretName = typeof FINGERPRINTED_SECRET_NAMES[number];

export const secretFingerprintsOf = (
  env: Pick<Env, FingerprintedSecretName>,
): readonly SecretFingerprint[] =>
  FINGERPRINTED_SECRET_NAMES.map((name): SecretFingerprint => {
    const value = env[name];
    return value === undefined || value === ''
      ? { name, set: false, fingerprint: null }
      : { name, set: true, fingerprint: secretFingerprint(name, value) };
  });

export const registerSecretFingerprintsRoute = (
  app: Hono<AppVars>,
  deps: { operatorSecret: string; secretFingerprints: readonly SecretFingerprint[] },
): void => {
  app.get(API_PATHS.secretFingerprints, (c) => {
    if (!secretEquals(c.req.header(SCHEDULER_OPERATOR_SECRET_HEADER), deps.operatorSecret)) {
      return respond(err(unauthorized('Invalid operator secret')));
    }
    return respond(ok({ secrets: [...deps.secretFingerprints] }));
  });
};
