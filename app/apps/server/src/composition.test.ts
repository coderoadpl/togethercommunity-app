import { afterAll, describe, expect, it } from 'vitest';

import { createTestDatabase } from '#adapters/db/test-database-name.js';

import { createDeps } from './composition.js';
import { envSchema } from './env.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

let database: Awaited<ReturnType<typeof createTestDatabase>> | undefined;

afterAll(async () => {
  await database?.close();
});

describe('createDeps', () => {
  it('builds without a keepAlive hook', async () => {
    database = await createTestDatabase('together_composition_test', baseDatabaseUrl);
    const env = envSchema.parse({
      NODE_ENV: 'test',
      DATABASE_URL: database.url,
      REALTIME_TRANSPORT: 'in-process',
      APP_BASE_URL: 'http://localhost:48730',
      BETTER_AUTH_SECRET: 'composition-secret-at-least-32-characters',
    });

    const deps = createDeps(env, { db: database.db });

    expect(deps.auth.flushAuthEmails).toEqual(expect.any(Function));
  });
});
