import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { z } from 'zod';

import { uniqueTestDatabaseName } from '#adapters/db/test-database-name.js';

import {
  bootServer,
  ephemeralPort,
  killServer,
  run,
  tsxBin,
} from './server-harness.js';

const PROBE_DB = uniqueTestDatabaseName('together_quickstart');
const baseDatabaseUrl =
  process.env['DATABASE_URL'] ??
  'postgres://together:together@localhost:48912/together';
const probeUrl = new URL(baseDatabaseUrl);
probeUrl.pathname = `/${PROBE_DB}`;
const probeDatabaseUrl = probeUrl.toString();

class QuickstartFailure extends Error {}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new QuickstartFailure(message);
}

const recreateDatabase = async (): Promise<void> => {
  const client = new pg.Client({ connectionString: baseDatabaseUrl });
  try {
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${PROBE_DB}`);
  } catch (cause) {
    throw new QuickstartFailure(
      `Could not prepare "${PROBE_DB}". Is Postgres running (pnpm run db:up)?\n${String(cause)}`,
    );
  } finally {
    await client.end();
  }
};

const dropDatabase = async (): Promise<void> => {
  const client = new pg.Client({ connectionString: baseDatabaseUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  } finally {
    await client.end();
  }
};

const runAppScript = async (script: string): Promise<void> => {
  const result = await run(tsxBin, [script], { DATABASE_URL: probeDatabaseUrl });
  assert(
    result.code === 0,
    `${script} failed with exit ${String(result.code)}\n${result.stdout}${result.stderr}`,
  );
};

const tableSchema = z.array(z.object({ table_name: z.string() }));
const countSchema = z.array(z.object({ count: z.coerce.number().int().nonnegative() })).length(1);

const readCounts = async (): Promise<Record<string, number>> => {
  const client = new pg.Client({ connectionString: probeDatabaseUrl });
  await client.connect();
  try {
    const tables = tableSchema.parse(
      (
        await client.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
        )
      ).rows,
    );
    const counts: Record<string, number> = {};
    for (const { table_name: table } of tables) {
      const rows = countSchema.parse(
        (await client.query(`SELECT count(*) AS count FROM ${pg.escapeIdentifier(table)}`)).rows,
      );
      counts[table] = rows[0]?.count ?? 0;
    }
    return counts;
  } finally {
    await client.end();
  }
};

const okEnvelopeSchema = z.object({ ok: z.literal(true), data: z.unknown() });
const healthSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    status: z.literal('ok'),
    database: z.literal('up'),
  }),
});
const productListSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    products: z.array(z.object({ id: z.string(), title: z.string() })).min(1),
  }),
});

const cli = async (args: string[], baseUrl: string, configDir: string): Promise<unknown> => {
  const result = await run(
    tsxBin,
    ['apps/cli/src/main.ts', '--json', '--api-url', baseUrl, ...args],
    { HOME: configDir },
  );
  assert(
    result.code === 0,
    `CLI ${args.join(' ')} failed with exit ${String(result.code)}\n${result.stdout}${result.stderr}`,
  );
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new QuickstartFailure(`CLI ${args.join(' ')} returned invalid JSON\n${result.stdout}`);
  }
};

const driveDocumentedCli = async (
  port: number,
  configDir: string,
): Promise<void> => {
  const baseUrl = `http://localhost:${String(port)}`;
  healthSchema.parse(await cli(['health'], baseUrl, configDir));
  okEnvelopeSchema.parse(
    await cli(
      ['login', '--email', 'creator2@together.dev', '--password', 'demo1234'],
      baseUrl,
      configDir,
    ),
  );
  productListSchema.parse(
    await cli(['--tenant', 'acme', 'product', 'list'], baseUrl, configDir),
  );
};

const startedAt = Date.now();
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'together-quickstart-'));
let server: ChildProcess | null = null;
let databaseCreated = false;

try {
  console.log('quickstart:probe: preparing a fresh database...');
  await recreateDatabase();
  databaseCreated = true;
  await runAppScript('adapters/db/migrate.ts');
  await runAppScript('adapters/db/seed.ts');

  const seededCounts = await readCounts();
  assert(
    (seededCounts['tenants'] ?? 0) > 0 &&
      (seededCounts['user'] ?? 0) > 0 &&
      (seededCounts['products'] ?? 0) > 0,
    `Fresh seed did not create the documented demo data\n${JSON.stringify(seededCounts)}`,
  );

  console.log('quickstart:probe: checking repeatable seed...');
  await runAppScript('adapters/db/seed.ts');
  const repeatedCounts = await readCounts();
  assert(
    JSON.stringify(repeatedCounts) === JSON.stringify(seededCounts),
    `Repeated seed changed row counts\nbefore=${JSON.stringify(seededCounts)}\nafter=${JSON.stringify(repeatedCounts)}`,
  );

  const port = await ephemeralPort();
  server = await bootServer({
    port,
    healthUrl: `http://localhost:${String(port)}/api/health`,
    env: {
      DATABASE_URL: probeDatabaseUrl,
      APP_BASE_URL: `http://localhost:${String(port)}`,
      WEB_DIST_DIR: temporaryDirectory,
      PAYMENT_PROVIDER: 'fake',
      EMAIL_PROVIDER: 'dev',
    },
  });
  console.log('quickstart:probe: driving the documented CLI path...');
  await driveDocumentedCli(port, temporaryDirectory);
  console.log(
    `\nquickstart:probe: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
  );
} catch (error) {
  const message =
    error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`\nquickstart:probe: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server !== null) await killServer(server);
  if (databaseCreated) {
    await dropDatabase().catch((cause) => {
      console.error(`quickstart:probe: cleanup failed\n${String(cause)}`);
      process.exitCode = 1;
    });
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
