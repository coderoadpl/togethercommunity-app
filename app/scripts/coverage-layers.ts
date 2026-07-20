import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

export interface Metric {
  total: number;
  covered: number;
  pct: number;
}

export interface LayerCoverage {
  lines: Metric;
  branches: Metric;
  functions: Metric;
  files: number;
}

const metricSchema = z.object({ total: z.number(), covered: z.number() });

const fileSummarySchema = z.object({
  lines: metricSchema,
  branches: metricSchema,
  functions: metricSchema,
});

const coverageSummarySchema = z.record(z.string(), fileSummarySchema);

export const LAYERS = [
  'core/domain',
  'core/contract',
  'core/server',
  'core/client',
  'adapters',
  'apps/web',
  'apps/cli',
  'apps/server',
  'scripts',
  'other',
] as const;

export type Layer = (typeof LAYERS)[number];

const appRoot = fileURLToPath(new URL('..', import.meta.url));

const layerFor = (absolutePath: string): Layer => {
  const rel = absolutePath.startsWith(appRoot) ? absolutePath.slice(appRoot.length) : absolutePath;
  for (const layer of LAYERS) {
    if (layer === 'other') continue;
    if (rel.startsWith(`${layer}/`)) return layer;
  }
  return 'other';
};

const emptyMetric = (): Metric => ({ total: 0, covered: 0, pct: 100 });

const finalizePct = (metric: Metric): void => {
  metric.pct = metric.total === 0 ? 100 : (metric.covered / metric.total) * 100;
};

export const readLayerCoverage = (summaryPath: string): Map<Layer, LayerCoverage> => {
  const byPath = coverageSummarySchema.parse(JSON.parse(readFileSync(summaryPath, 'utf8')));

  const result = new Map<Layer, LayerCoverage>();
  for (const layer of LAYERS) {
    result.set(layer, {
      lines: emptyMetric(),
      branches: emptyMetric(),
      functions: emptyMetric(),
      files: 0,
    });
  }

  for (const [path, summary] of Object.entries(byPath)) {
    if (path === 'total') continue;
    const bucket = result.get(layerFor(path));
    if (!bucket) continue;
    bucket.files += 1;
    bucket.lines.total += summary.lines.total;
    bucket.lines.covered += summary.lines.covered;
    bucket.branches.total += summary.branches.total;
    bucket.branches.covered += summary.branches.covered;
    bucket.functions.total += summary.functions.total;
    bucket.functions.covered += summary.functions.covered;
  }

  for (const bucket of result.values()) {
    finalizePct(bucket.lines);
    finalizePct(bucket.branches);
    finalizePct(bucket.functions);
  }
  return result;
};

export const round1 = (value: number): number => Math.round(value * 10) / 10;
