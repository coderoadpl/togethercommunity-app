import { z } from 'zod';

import { tenantSettingsSchema } from './tenant.js';

const deepHealthCheckSchema = z.object({
  name: z.string().min(1),
  ok: z.boolean(),
  ms: z.number().int().nonnegative(),
  error: z.string().nullable(),
});

export const deepHealthReportSchema = z.object({
  ok: z.boolean(),
  checkedAt: z.string().datetime(),
  failing: z.array(z.string().min(1)),
  checks: z.array(deepHealthCheckSchema),
});

export interface DeepHealthCheck extends z.output<typeof deepHealthCheckSchema> {
  subjects: number;
}

export interface DeepHealthReport
  extends Omit<z.output<typeof deepHealthReportSchema>, 'checks'> {
  tenants: number;
  checks: DeepHealthCheck[];
}

/**
 * Anonymous callers learn which checks failed, never how much platform there
 * is: the tenant count and the per-check subject counts stay server-side.
 */
export const toPublicDeepHealthReport = (
  report: DeepHealthReport,
): z.output<typeof deepHealthReportSchema> => deepHealthReportSchema.parse(report);

export const tenantSettingsParseFailure = (settings: unknown): string | null => {
  const parsed = tenantSettingsSchema.safeParse(settings);
  if (parsed.success) return null;
  return [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ');
};
