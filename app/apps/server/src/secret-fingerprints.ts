import type { Hono, MiddlewareHandler } from 'hono';

import { secretFingerprint } from '#adapters/crypto/secret-fingerprint.js';
import {
  API_PATHS,
  FINGERPRINTED_SECRET_NAMES,
  OUT_OF_SCHEMA_SECRET_NAMES,
  SECRET_FINGERPRINT_READ_SECRET_HEADER,
  type SecretFingerprint,
} from '#core/contract/index.js';
import { err, ok, unauthorized } from '#core/domain/index.js';

import type { AppVars } from './app-vars.js';
import { envSchema, type Env } from './env.js';
import { respond } from './respond.js';
import { secretEquals } from './secret-equals.js';

type FingerprintedSecretName = typeof FINGERPRINTED_SECRET_NAMES[number];
type OutOfSchemaSecretName = typeof OUT_OF_SCHEMA_SECRET_NAMES[number];
type OutOfSchemaSecrets = Readonly<Partial<Record<OutOfSchemaSecretName, string>>>;

const schemaDefaultOf = (name: FingerprintedSecretName): unknown =>
  envSchema._def.schema.shape[name].safeParse(undefined).data;

const fingerprintOf = (name: string, value: string | undefined, unsetValue: unknown): SecretFingerprint =>
  value === undefined || value === '' || value === unsetValue
    ? { name, set: false, fingerprint: null }
    : { name, set: true, fingerprint: secretFingerprint(name, value) };

export const secretFingerprintsOf = (
  env: Pick<Env, FingerprintedSecretName>,
  processEnv: OutOfSchemaSecrets,
): readonly SecretFingerprint[] => [
  ...FINGERPRINTED_SECRET_NAMES.map((name) => fingerprintOf(name, env[name], schemaDefaultOf(name))),
  ...OUT_OF_SCHEMA_SECRET_NAMES.map((name) => fingerprintOf(name, processEnv[name], undefined)),
];

export const selectSecretFingerprintReadSecret = (
  env: Pick<Env, FingerprintedSecretName>,
  processEnv: OutOfSchemaSecrets,
  operatorSecret: string,
): string | undefined => {
  const readSecret = env.SECRET_FINGERPRINT_READ_SECRET;
  if (readSecret === undefined) return undefined;
  const platformSecrets = [
    operatorSecret,
    ...FINGERPRINTED_SECRET_NAMES.filter((name) => name !== 'SECRET_FINGERPRINT_READ_SECRET').map((name) => env[name]),
    ...OUT_OF_SCHEMA_SECRET_NAMES.map((name) => processEnv[name]),
  ];
  return platformSecrets.includes(readSecret) ? undefined : readSecret;
};

type SecretFingerprintsAuth = { secretFingerprintReadSecret: string | undefined };

const authorized = (header: string | undefined, { secretFingerprintReadSecret }: SecretFingerprintsAuth): boolean =>
  secretFingerprintReadSecret !== undefined && secretEquals(header, secretFingerprintReadSecret);

const rejection = () => respond(err(unauthorized('Invalid operator secret')));

export const secretFingerprintsGuard = (deps: SecretFingerprintsAuth): MiddlewareHandler<AppVars> =>
  async (c, next) => {
    if (!authorized(c.req.header(SECRET_FINGERPRINT_READ_SECRET_HEADER), deps)) return rejection();
    await next();
  };

export const registerSecretFingerprintsRoute = (
  app: Hono<AppVars>,
  deps: SecretFingerprintsAuth & { secretFingerprints: readonly SecretFingerprint[] },
): void => {
  app.get(API_PATHS.secretFingerprints, (c) => {
    if (!authorized(c.req.header(SECRET_FINGERPRINT_READ_SECRET_HEADER), deps)) return rejection();
    return respond(ok({ secrets: [...deps.secretFingerprints] }));
  });
};
