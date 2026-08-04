import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const pixelmatchCli = require.resolve('pixelmatch/bin/pixelmatch');
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pixelmatchOptions = { threshold: 0, includeAA: false };
const maxDiffPixels = 10;

const readPngSize = (path: string): { width: number; height: number } => {
  const header = readFileSync(path).subarray(0, 24);
  if (header.length < 24 || !header.subarray(0, 8).equals(pngSignature)) {
    throw new Error(`Invalid PNG: ${path}`);
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
};

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

  const baseline = readPngSize(baselinePath);
  const current = readPngSize(currentPath);
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return {
      file,
      reason: `size mismatch: baseline ${baseline.width}x${baseline.height} vs current ${current.width}x${current.height}`,
    };
  }

  const result = spawnSync(
    process.execPath,
    [
      pixelmatchCli,
      baselinePath,
      currentPath,
      diffPath,
      String(pixelmatchOptions.threshold),
      String(pixelmatchOptions.includeAA),
    ],
    { encoding: 'utf8' },
  );
  if (result.error !== undefined) throw result.error;
  const match = /different pixels: (\d+)/.exec(result.stdout);
  if ((result.status !== 0 && result.status !== 66) || match?.[1] === undefined) {
    throw new Error(result.stderr || result.stdout || `pixelmatch exited ${String(result.status)}`);
  }
  const mismatched = Number(match[1]);
  if (mismatched <= maxDiffPixels) return null;
  const ratio = mismatched / (baseline.width * baseline.height);
  return {
    file,
    reason: `${mismatched} px differ (${(ratio * 100).toFixed(3)}%, limit ${String(maxDiffPixels)} px) — diff: ${diffPath}`,
  };
};
