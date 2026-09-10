import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BETTER_AUTH_MAGIC_LINK_PATH,
  BETTER_AUTH_PASSWORD_SIGN_IN_PATH,
  BETTER_AUTH_SIGN_UP_PATH,
} from '#adapters/auth/create-auth.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { PASSWORD_MIN_LENGTH } from '#core/domain/index.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';
import { SIGN_IN_RESPONSE_FLOOR_MS } from './sign-in-timing.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const baseUrl = 'http://localhost:48730';
const registeredPassword = 'registered'.padEnd(PASSWORD_MIN_LENGTH, 'x');
const attemptedPassword = 'attempted'.padEnd(PASSWORD_MIN_LENGTH, 'x');

const registered = `enumeration-registered-${crypto.randomUUID()}@example.com`;
const unknown = `enumeration-unknown-${crypto.randomUUID()}@example.com`;

/** The two compared calls carry different addresses, so echoed input, ids and timestamps are not differences. */
const withoutVolatileValues = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutVolatileValues);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, withoutVolatileValues(entry)]),
    );
  }
  if (typeof value !== 'string') return value;
  return value
    .replaceAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, '<id>')
    .replaceAll(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/gu, '<timestamp>')
    .replaceAll(registered, '<address>')
    .replaceAll(unknown, '<address>');
};

let database: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
let app: ReturnType<typeof buildApp>;

const post = async (path: string, body: unknown): Promise<{
  status: number;
  body: unknown;
  elapsedMs: number;
}> => {
  const startedAt = performance.now();
  const response = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'localhost:48730', origin: baseUrl },
    body: JSON.stringify(body),
  });
  const parsed: unknown = await response.json().catch(() => null);
  return { status: response.status, body: parsed, elapsedMs: performance.now() - startedAt };
};

beforeAll(async () => {
  database = await createTestDatabase('together_sign_in_enumeration_test', baseDatabaseUrl);
  const env = envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: database.url,
    REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl,
    BETTER_AUTH_SECRET: 'sign-in-enumeration-secret-at-least-32-characters',
  });
  app = buildApp(createDeps(env, { db: database.db }));

  const signedUp = await post(BETTER_AUTH_SIGN_UP_PATH, {
    name: 'Registered',
    email: registered,
    password: registeredPassword,
    callbackURL: `${baseUrl}/login?verification=verified`,
  });
  expect(signedUp.status).toBe(200);
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('sign-in enumeration resistance', () => {
  it('answers a wrong password and an unknown address identically', async () => {
    const wrongPassword = await post(BETTER_AUTH_PASSWORD_SIGN_IN_PATH, {
      email: registered,
      password: attemptedPassword,
    });
    const unknownAddress = await post(BETTER_AUTH_PASSWORD_SIGN_IN_PATH, {
      email: unknown,
      password: attemptedPassword,
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownAddress.status).toBe(wrongPassword.status);
    expect(withoutVolatileValues(unknownAddress.body))
      .toEqual(withoutVolatileValues(wrongPassword.body));
    expect(wrongPassword.elapsedMs).toBeGreaterThanOrEqual(SIGN_IN_RESPONSE_FLOOR_MS);
    expect(unknownAddress.elapsedMs).toBeGreaterThanOrEqual(SIGN_IN_RESPONSE_FLOOR_MS);
  });

  it('acknowledges a magic link for a registered and an unknown address identically', async () => {
    const request = (email: string) =>
      post(BETTER_AUTH_MAGIC_LINK_PATH, { email, callbackURL: `${baseUrl}/` });
    const registeredLink = await request(registered);
    const unknownLink = await request(unknown);

    expect(registeredLink.status).toBe(200);
    expect(unknownLink.status).toBe(registeredLink.status);
    expect(withoutVolatileValues(unknownLink.body))
      .toEqual(withoutVolatileValues(registeredLink.body));
    expect(registeredLink.elapsedMs).toBeGreaterThanOrEqual(SIGN_IN_RESPONSE_FLOOR_MS);
    expect(unknownLink.elapsedMs).toBeGreaterThanOrEqual(SIGN_IN_RESPONSE_FLOOR_MS);
  });
});
