import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface PngComparisonFailure {
  file: string;
  reason: string;
}

interface ComparePngOptions {
  file: string;
  baselinePath: string;
  currentPath: string;
  diffPath: string;
  missingBaselineReason: string;
}

export const comparePng = ({
  file,
  baselinePath,
  currentPath,
  diffPath,
  missingBaselineReason,
}: ComparePngOptions): PngComparisonFailure | null => {
  if (!existsSync(baselinePath)) return { file, reason: missingBaselineReason };

  const baseline = PNG.sync.read(readFileSync(baselinePath));
  const current = PNG.sync.read(readFileSync(currentPath));
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return {
      file,
      reason: `size mismatch: baseline ${baseline.width}x${baseline.height} vs current ${current.width}x${current.height}`,
    };
  }

  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const mismatched = pixelmatch(
    baseline.data,
    current.data,
    diff.data,
    baseline.width,
    baseline.height,
    { threshold: 0, includeAA: false },
  );
  if (mismatched === 0) return null;

  writeFileSync(diffPath, PNG.sync.write(diff));
  const ratio = mismatched / (baseline.width * baseline.height);
  return {
    file,
    reason: `${mismatched} px differ (${(ratio * 100).toFixed(3)}%, limit 0.000%) — diff: ${diffPath}`,
  };
};
