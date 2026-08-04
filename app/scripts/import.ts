import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { accessItemSchema, chapterSchema, lessonBlockSchema } from '#core/domain/index.js';
import { createAuth } from '#adapters/auth/create-auth.js';
import { createImportAuthGateway } from '#adapters/auth/import-credential.js';
import { createEmailHmac } from '#adapters/crypto/email-hmac.js';
import { createDb } from '#adapters/db/client.js';
import { createEmailOutboxRepository } from '#adapters/db/email-outbox.js';
import {
  ImportFailure,
  resolveImportTenants,
  runImport,
  type ImportAnomaly,
  type ImportRunResult,
  type ImportTarget,
  type KindReport,
  type TenantBundle,
  type TenantMapping,
  type VerificationReport,
} from '#adapters/db/importer.js';
import { assertSafeBundleSlug } from './import-bundle-slug.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Usage: pnpm run import --bundle <dir> --tenant <bundleSlug>=<targetTenantIdOrSlug> [--tenant ...] \\
  [--dry-run | --apply] [--create-tenants --owner-email <email>] [--database-url <url>]

The bundle directory is a legacy-export output (contains tenants/<slug>/*.json).
Default mode is --dry-run: nothing is written, a diff report is produced.`;

interface CliArgs {
  bundleDir: string;
  mappings: TenantMapping[];
  apply: boolean;
  createTenants: boolean;
  ownerEmail: string | null;
  databaseUrl: string;
}

class UsageError extends Error {}

const parseArgs = (argv: string[]): CliArgs => {
  let bundleDir: string | null = null;
  const mappings: TenantMapping[] = [];
  let apply = false;
  let createTenants = false;
  let ownerEmail: string | null = null;
  let databaseUrl =
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

  const takeValue = (flag: string, index: number): string => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`${flag} requires a value`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    switch (arg) {
      case '--bundle':
        bundleDir = takeValue(arg, index);
        index += 1;
        break;
      case '--tenant': {
        const raw = takeValue(arg, index);
        index += 1;
        const [bundleSlug, target, ...rest] = raw.split('=');
        if (!bundleSlug || !target || rest.length > 0) {
          throw new UsageError(`--tenant expects <bundleSlug>=<targetTenantIdOrSlug>, got "${raw}"`);
        }
        mappings.push({ bundleSlug, target });
        break;
      }
      case '--apply':
        apply = true;
        break;
      case '--dry-run':
        apply = false;
        break;
      case '--create-tenants':
        createTenants = true;
        break;
      case '--owner-email':
        ownerEmail = takeValue(arg, index);
        index += 1;
        break;
      case '--database-url':
        databaseUrl = takeValue(arg, index);
        index += 1;
        break;
      default:
        throw new UsageError(`Unknown argument "${arg}"`);
    }
  }
  if (bundleDir === null) throw new UsageError('--bundle is required');
  if (mappings.length === 0) throw new UsageError('At least one --tenant mapping is required');
  const seen = new Set<string>();
  for (const mapping of mappings) {
    if (seen.has(mapping.bundleSlug)) {
      throw new UsageError(`Duplicate --tenant mapping for bundle slug "${mapping.bundleSlug}"`);
    }
    seen.add(mapping.bundleSlug);
  }
  if (createTenants && ownerEmail === null) {
    throw new UsageError('--create-tenants requires --owner-email');
  }
  return { bundleDir, mappings, apply, createTenants, ownerEmail, databaseUrl };
};

const legacyId = z.string().min(1);

const bundleUserSchema = z.object({
  legacyId,
  email: z.string().min(3),
  name: z.string().nullable(),
  legacyPasswordMarker: z.string().min(1).nullable(),
  role: z.enum(['admin', 'student']),
});

const bundleCourseSchema = z.object({
  legacyId,
  name: z.string().min(1),
  description: z.string(),
  imageUrl: z.string().nullable(),
  moduleOrder: z.array(legacyId),
});

const bundleModuleSchema = z.object({
  legacyId,
  courseLegacyIds: z.array(legacyId),
  title: z.string().min(1),
  prefix: z.string().nullable(),
  name: z.string().min(1),
  chapters: z.array(chapterSchema),
});

const bundleLessonSchema = z.object({
  legacyId,
  name: z.string().min(1),
  contents: z.array(lessonBlockSchema),
});

const bundleProductSchema = z.object({
  legacyId,
  title: z.string().min(1),
  accessItems: z.array(accessItemSchema),
});

const bundleMemberSchema = z.object({
  legacyId,
  email: z.string().min(3),
  displayName: z.string().nullable(),
});

const bundleGrantSchema = z.object({
  legacyId,
  memberLegacyId: legacyId,
  productLegacyId: legacyId,
  startsAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
});

const bundleProgressSchema = z.object({
  legacyId,
  userLegacyId: legacyId,
  courseLegacyId: legacyId,
  lastViewedLessonId: z.string().nullable(),
  lastViewedModuleId: z.string().nullable(),
  lastViewedChapterId: z.string().nullable(),
  completedLessonIds: z.array(legacyId),
  updatedAt: z.string().nullable(),
});

const readBundleFile = <S extends z.ZodTypeAny>(
  path: string,
  schema: S,
): z.output<S>[] => {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new ImportFailure(`Cannot read bundle file ${path}: ${String(cause)}`);
  }
  const parsed = z.array(schema).safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new ImportFailure(`Bundle file ${path} failed validation:\n${parsed.error.message.slice(0, 2000)}`);
  }
  return parsed.data;
};

const loadTenantBundle = (bundleDir: string, bundleSlug: string): TenantBundle => {
  const tenantDir = join(bundleDir, 'tenants', assertSafeBundleSlug(bundleSlug));
  return {
    users: readBundleFile(join(tenantDir, 'users.json'), bundleUserSchema),
    courses: readBundleFile(join(tenantDir, 'courses.json'), bundleCourseSchema),
    modules: readBundleFile(join(tenantDir, 'modules.json'), bundleModuleSchema),
    lessons: readBundleFile(join(tenantDir, 'lessons.json'), bundleLessonSchema),
    products: readBundleFile(join(tenantDir, 'products.json'), bundleProductSchema),
    members: readBundleFile(join(tenantDir, 'members.json'), bundleMemberSchema),
    grants: readBundleFile(join(tenantDir, 'grants.json'), bundleGrantSchema),
    progress: readBundleFile(join(tenantDir, 'progress.json'), bundleProgressSchema),
  };
};

const redactedUrl = (raw: string): string => {
  try {
    const url = new URL(raw);
    if (url.password.length > 0) url.password = '****';
    return url.toString();
  } catch {
    return '(unparsable database url)';
  }
};

const kindTable = (reports: KindReport[]): string[] => [
  '| kind | create | update | skip | dropped | anomalies |',
  '|---|---:|---:|---:|---:|---:|',
  ...reports.map(
    (report) =>
      `| ${report.kind} | ${String(report.create)} | ${String(report.update)} | ${String(report.skip)} | ${String(report.dropped)} | ${String(report.anomalies.length)} |`,
  ),
];

const sampleLines = (reports: KindReport[]): string[] => {
  const lines: string[] = [];
  for (const report of reports) {
    if (report.samples.length === 0) continue;
    lines.push('', `Update samples — ${report.kind}:`);
    for (const sample of report.samples) {
      lines.push(`- \`${sample.key}\``);
      for (const change of sample.changes) {
        lines.push(`  - ${change.field}: ${change.before} -> ${change.after}`);
      }
    }
  }
  return lines;
};

const anomalyLines = (anomalies: ImportAnomaly[], limit: number): string[] => {
  const lines = anomalies
    .slice(0, limit)
    .map((anomaly) => `- [${anomaly.kind}] ${anomaly.subject}: ${anomaly.detail}`);
  if (anomalies.length > limit) lines.push(`- ...and ${String(anomalies.length - limit)} more`);
  return lines;
};

const verificationLines = (verification: VerificationReport): string[] => {
  const lines: string[] = ['', '## Verification', ''];
  for (const tenant of verification.tenants) {
    lines.push(`### ${tenant.bundleSlug} -> ${tenant.tenantId} — ${tenant.pass ? 'PASS' : 'FAIL'}`, '');
    lines.push('| kind | bundle | expected in db | matched in db | extra legacy rows | pass |');
    lines.push('|---|---:|---:|---:|---:|---|');
    for (const count of tenant.counts) {
      lines.push(
        `| ${count.kind} | ${String(count.bundle)} | ${String(count.expectedInDb)} | ${String(count.matchedInDb)} | ${String(count.extraLegacyInDb)} | ${count.pass ? 'yes' : 'NO'} |`,
      );
    }
    lines.push(
      '',
      `Password markers verified: ${String(tenant.markersVerified)}/${String(tenant.markersTotal)}`,
      '',
      'Entitlement spot checks:',
    );
    if (tenant.spotChecks.length === 0) lines.push('- (no members with grants to sample)');
    for (const check of tenant.spotChecks) {
      lines.push(
        `- member ${check.memberLegacyId} (${check.email}) lesson ${check.lessonLegacyId}: expected ${
          check.expectedAccessible ? 'accessible' : 'denied'
        }, got ${check.actual} — ${check.pass ? 'pass' : 'FAIL'}`,
      );
    }
    lines.push('');
  }
  lines.push(`Overall verification: ${verification.pass ? 'PASS' : 'FAIL'}`);
  return lines;
};

const renderReport = (
  args: CliArgs,
  targets: ImportTarget[],
  result: ImportRunResult,
): string => {
  const lines: string[] = [
    '# Legacy import report',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Mode: ${result.mode}`,
    `- Bundle: ${args.bundleDir}`,
    `- Database: ${redactedUrl(args.databaseUrl)}`,
    '',
    '## Users (global)',
    '',
    ...kindTable([result.users]),
    ...sampleLines([result.users]),
  ];
  for (const tenantResult of result.tenants) {
    const target = targets.find((entry) => entry.tenant.bundleSlug === tenantResult.bundleSlug);
    lines.push(
      '',
      `## Tenant ${tenantResult.bundleSlug} -> ${tenantResult.tenantId}${
        target?.tenant.created === true ? ' (created by this run)' : ''
      }`,
      '',
      ...kindTable(tenantResult.kinds),
      ...sampleLines(tenantResult.kinds),
    );
  }
  const allAnomalies = [
    ...result.users.anomalies,
    ...result.tenants.flatMap((tenant) => tenant.kinds.flatMap((kind) => kind.anomalies)),
  ];
  lines.push('', `## Anomalies (${String(allAnomalies.length)})`, '');
  lines.push(...(allAnomalies.length === 0 ? ['- none'] : anomalyLines(allAnomalies, 200)));
  if (result.verification !== null) lines.push(...verificationLines(result.verification));
  lines.push('');
  return lines.join('\n');
};

const main = async (): Promise<number> => {
  const args = parseArgs(process.argv.slice(2));

  const db = createDb('node-postgres', args.databaseUrl);
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
  const gateway = createImportAuthGateway(auth);
  const emailHmac = createEmailHmac(
    process.env['SECRETS_MASTER_KEY'] ??
      'dG9nZXRoZXItZGV2LXNlY3JldHMtbWFzdGVyLWtleSE=',
  );
  const nowIso = (): string => new Date().toISOString();

  const resolved = await resolveImportTenants(db, gateway, args.mappings, {
    createMissing: args.createTenants,
    ownerEmail: args.ownerEmail,
    apply: args.apply,
    nowIso,
  });

  const targets: ImportTarget[] = resolved.map((tenant) => ({
    tenant,
    bundle: loadTenantBundle(args.bundleDir, tenant.bundleSlug),
  }));

  const result = await runImport(db, gateway, targets, {
    apply: args.apply,
    nowIso,
    emailHmac,
  });

  const report = renderReport(args, targets, result);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = join(rootDir, 'out', `import-report-${timestamp}.md`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, report);

  console.log(report);
  console.log(`import: report written to ${reportPath}`);

  if (result.verification !== null && !result.verification.pass) {
    console.error('import: post-apply verification FAILED');
    return 1;
  }
  return 0;
};

try {
  const code = await main();
  process.exit(code);
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`import: ${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (error instanceof ImportFailure) {
    console.error(`import: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
