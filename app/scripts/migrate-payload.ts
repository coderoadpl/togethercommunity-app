import crypto from 'node:crypto';

import { eq } from 'drizzle-orm';
import { MongoClient, ObjectId } from 'mongodb';
import { z } from 'zod';

import { createAuth } from '#adapters/auth/create-auth.js';
import { createImportAuthGateway } from '#adapters/auth/import-credential.js';
import { createEmailHmac } from '#adapters/crypto/email-hmac.js';
import { createDb } from '#adapters/db/client.js';
import { createEmailOutboxRepository } from '#adapters/db/email-outbox.js';
import {
  runImport,
  type ImportRunResult,
  type ImportTarget,
  type KindReport,
  type TenantBundle,
} from '#adapters/db/importer.js';
import { tenants } from '#adapters/db/schema.js';
import {
  buildPayloadMigrationPlan,
  PayloadMigrationFailure,
  type PayloadMigrationPlan,
  type PayloadSourceCollections,
} from './payload-migration.js';

const configSchema = z.object({
  sourceMongoUrl: z.string().url(),
  targetDatabaseUrl: z.string().min(1),
  tenantSlug: z.string().min(1),
  apply: z.boolean(),
});

class UsageError extends Error {}

const parseConfig = () => {
  const supported = new Set(['--', '--apply', '--dry-run']);
  const unknown = process.argv.slice(2).filter((arg) => !supported.has(arg));
  if (unknown.length > 0) throw new UsageError(`Unknown arguments: ${unknown.join(', ')}`);
  const dryRun = z.enum(['true', 'false']).parse(process.env['DRY_RUN'] ?? 'true') === 'true';
  const apply = process.argv.includes('--apply') || (!process.argv.includes('--dry-run') && !dryRun);
  return configSchema.parse({
    sourceMongoUrl: process.env['SOURCE_MONGO_URL'] ?? 'mongodb://localhost:47017/test',
    targetDatabaseUrl: process.env['TARGET_DATABASE_URL'],
    tenantSlug: process.env['TENANT_SLUG'] ?? 'coderoad',
    apply,
  });
};

const normalizeBson = (value: unknown): unknown => {
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeBson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeBson(entry)]),
    );
  }
  return value;
};

const readSource = async (client: MongoClient): Promise<PayloadSourceCollections> => {
  const database = client.db();
  const read = async (name: string): Promise<unknown[]> =>
    (await database.collection(name).find({}).toArray()).map(normalizeBson);
  const [
    courses,
    modules,
    lessons,
    videos,
    pdfs,
    images,
    accesses,
    enrollments,
    users,
    progress,
  ] = await Promise.all([
    read('courses'),
    read('course-modules'),
    read('course-lessons'),
    read('video-files'),
    read('pdf-files'),
    read('course-images'),
    read('accesses'),
    read('enrollments'),
    read('users'),
    read('user-progresses'),
  ]);
  return { courses, modules, lessons, videos, pdfs, images, accesses, enrollments, users, progress };
};

const contentOnlyBundle = (bundle: TenantBundle): TenantBundle => ({
  users: [],
  courses: bundle.courses,
  modules: bundle.modules,
  lessons: bundle.lessons,
  products: bundle.products,
  members: [],
  grants: [],
  progress: [],
});

const reportByKind = (result: ImportRunResult, kind: string): KindReport | null => {
  for (const tenant of result.tenants) {
    const report = tenant.kinds.find((entry) => entry.kind === kind);
    if (report !== undefined) return report;
  }
  return kind === 'users' ? result.users : null;
};

const countLines = (title: string, counts: Record<string, number>): string[] => [
  title,
  ...Object.entries(counts).map(([kind, count]) => `  ${kind}: ${String(count)}`),
];

const actionLine = (report: KindReport): string =>
  `  ${report.kind}: create=${String(report.create)} update=${String(report.update)} unchanged=${String(report.skip)} dropped=${String(report.dropped)}`;

const renderReport = (
  config: ReturnType<typeof parseConfig>,
  plan: PayloadMigrationPlan,
  contentResult: ImportRunResult | null,
  finalResult: ImportRunResult,
): string => {
  const lines = [
    `CodeRoad Payload migration: ${config.apply ? 'APPLY' : 'DRY RUN'}`,
    `Tenant: ${config.tenantSlug}`,
    `Source: ${config.sourceMongoUrl}`,
    ...countLines('Source counts:', plan.sourceCounts),
    ...countLines('Selected/importable counts:', plan.selectedCounts),
    ...countLines('Lesson blocks:', plan.blockCounts),
    `Renewal merges: ${String(plan.renewalMerges.length)} pairs, ${String(
      plan.renewalMerges.reduce(
        (count, merge) => count + merge.enrollmentLegacyIds.length - 1,
        0,
      ),
    )} duplicate rows collapsed`,
    'Skipped:',
    ...(plan.skips.length === 0
      ? ['  none']
      : plan.skips.map(
          (skip) =>
            `  ${skip.entity}: ${String(skip.count)} — ${skip.reason}; samples=${skip.samples.join(',')}`,
        )),
    'Database actions:',
  ];
  const kinds = ['courses', 'modules', 'lessons', 'products', 'users', 'members', 'grants', 'progress'];
  for (const kind of kinds) {
    const report =
      contentResult !== null && ['courses', 'modules', 'lessons', 'products'].includes(kind)
        ? reportByKind(contentResult, kind)
        : reportByKind(finalResult, kind);
    if (report !== null) lines.push(actionLine(report));
  }
  const verification = finalResult.verification;
  if (verification !== null) {
    lines.push(`Reconciliation: ${verification.pass ? 'PASS' : 'FAIL'}`);
    for (const tenant of verification.tenants) {
      for (const count of tenant.counts) {
        lines.push(
          `  ${count.kind}: source=${String(count.bundle)} expected=${String(count.expectedInDb)} matched=${String(count.matchedInDb)} extra=${String(count.extraLegacyInDb)} ${count.pass ? 'PASS' : 'FAIL'}`,
        );
      }
      lines.push(
        `  credentials: expected=${String(tenant.markersTotal)} verified-or-rehashed=${String(tenant.markersVerified)}`,
      );
      lines.push(
        `  access spot checks: ${String(tenant.spotChecks.filter((check) => check.pass).length)}/${String(tenant.spotChecks.length)}`,
      );
    }
  }
  return lines.join('\n');
};

const main = async (): Promise<number> => {
  const config = parseConfig();
  const db = createDb('node-postgres', config.targetDatabaseUrl);
  const tenantRows = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, config.tenantSlug))
    .limit(2);
  if (tenantRows.length !== 1) {
    throw new PayloadMigrationFailure(
      `Tenant slug ${JSON.stringify(config.tenantSlug)} must resolve to exactly one existing tenant`,
    );
  }
  const tenant = tenantRows[0];
  if (tenant === undefined) throw new PayloadMigrationFailure('Target tenant lookup failed');

  const sourceClient = new MongoClient(config.sourceMongoUrl, { directConnection: true });
  await sourceClient.connect();
  let plan: PayloadMigrationPlan;
  try {
    plan = buildPayloadMigrationPlan(await readSource(sourceClient));
  } finally {
    await sourceClient.close();
  }

  const auth = createAuth(db, {
    secret: process.env['BETTER_AUTH_SECRET'] ?? 'dev-only-secret-do-not-use-in-prod',
    baseUrl: 'http://localhost:48730',
    baseDomain: 'localhost',
    singleTenantMode: false,
    trustedOrigins: () => ['http://localhost:48730'],
    secureCookies: false,
    exposeMagicLinks: false,
    emailOutbox: createEmailOutboxRepository(db),
    ids: { nextId: () => crypto.randomUUID() },
    clock: { nowIso: () => new Date().toISOString() },
    dispatchEmail: () => undefined,
    defaultTenantName: 'Together',
    google: null,
  });
  const target: ImportTarget = {
    tenant: {
      bundleSlug: 'coderoad',
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      created: false,
    },
    bundle: plan.bundle,
  };
  const options = {
    apply: config.apply,
    nowIso: () => new Date().toISOString(),
    emailHmac: createEmailHmac(
      process.env['SECRETS_MASTER_KEY'] ??
        'dG9nZXRoZXItZGV2LXNlY3JldHMtbWFzdGVyLWtleSE=',
    ),
  };
  const gateway = createImportAuthGateway(auth);
  if (!config.apply) {
    const result = await runImport(db, gateway, [target], options);
    console.log(renderReport(config, plan, null, result));
    return 0;
  }

  const contentTarget: ImportTarget = { ...target, bundle: contentOnlyBundle(plan.bundle) };
  const contentResult = await runImport(db, gateway, [contentTarget], options);
  if (contentResult.verification?.pass !== true) {
    console.log(renderReport(config, plan, contentResult, contentResult));
    return 1;
  }
  const finalResult = await runImport(db, gateway, [target], options);
  console.log(renderReport(config, plan, contentResult, finalResult));
  return finalResult.verification?.pass === true ? 0 : 1;
};

try {
  const code = await main();
  process.exit(code);
} catch (error) {
  if (error instanceof UsageError || error instanceof PayloadMigrationFailure) {
    console.error(`migrate-payload: ${error.message}`);
    process.exit(1);
  }
  if (error instanceof z.ZodError) {
    console.error(`migrate-payload: invalid configuration: ${error.message}`);
    process.exit(2);
  }
  throw error;
}
