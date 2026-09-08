import { z } from 'zod';

import { tenantSettingsSchema } from './tenant.js';
import type { StorageCorsProbeResult } from './storage.js';

const deepHealthCheckSchema = z.object({
  name: z.string().min(1),
  ok: z.boolean(),
  ms: z.number().int().nonnegative(),
  error: z.string().nullable(),
  skipped: z.string().nullable(),
});

const publicStorageCorsStatusSchema = z.enum(['ok', 'warning', 'not-applicable']);

export const deepHealthReportSchema = z.object({
  ok: z.boolean(),
  checkedAt: z.string().datetime(),
  failing: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)).default([]),
  checks: z.array(deepHealthCheckSchema),
  storageCors: publicStorageCorsStatusSchema.default('not-applicable'),
});

export interface DeepHealthStorageCors {
  tenantId: string;
  cached: boolean;
  results: StorageCorsProbeResult[];
}

export interface DeepHealthCheck extends z.output<typeof deepHealthCheckSchema> {
  subjects: number;
}

export interface DeepHealthReport
  extends Omit<z.output<typeof deepHealthReportSchema>, 'checks' | 'storageCors'> {
  tenants: number;
  checks: DeepHealthCheck[];
  storageCors: DeepHealthStorageCors[];
}

/**
 * Anonymous callers learn which checks failed, never how much platform there is:
 * tenant counts, per-check subject counts and per-tenant CORS origins stay server-side.
 */
export const toPublicDeepHealthReport = (
  report: DeepHealthReport,
): z.output<typeof deepHealthReportSchema> => deepHealthReportSchema.parse({
  ...report,
  checks: report.checks.map((check) => check.name === 'tenant-secret-decryption' && !check.ok
    ? { ...check, error: 'stored secret integrity check failed' }
    : check),
  storageCors: publicStorageCorsStatus(report.storageCors),
});

const publicStorageCorsStatus = (
  entries: DeepHealthStorageCors[],
): z.output<typeof publicStorageCorsStatusSchema> => {
  if (entries.length === 0) return 'not-applicable';
  return entries.some((entry) => entry.results.some((result) => result.status !== 'ok'))
    ? 'warning'
    : 'ok';
};

export const tenantSettingsParseFailure = (settings: unknown): string | null => {
  const parsed = tenantSettingsSchema.safeParse(settings);
  if (parsed.success) return null;
  return [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ');
};
