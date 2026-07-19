import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { LAYERS, readLayerCoverage, round1 } from './coverage-layers.js';

const summaryPath = fileURLToPath(new URL('../coverage/coverage-summary.json', import.meta.url));
const baselinePath = fileURLToPath(new URL('../coverage-baseline.json', import.meta.url));

const floorSchema = z.object({ lines: z.number(), branches: z.number(), functions: z.number() });

const baselineSchema = z.object({ floors: z.record(z.string(), floorSchema) });

const main = (): void => {
  if (!existsSync(summaryPath)) {
    console.error(`Coverage summary not found at ${summaryPath}. Run \`npm run coverage\` first.`);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(baselinePath)) {
    console.error(`No coverage-baseline.json found at ${baselinePath}.`);
    process.exitCode = 1;
    return;
  }

  const baseline = baselineSchema.parse(JSON.parse(readFileSync(baselinePath, 'utf8')));
  const byLayer = readLayerCoverage(summaryPath);
  const failures: string[] = [];

  for (const layer of LAYERS) {
    const floor = baseline.floors[layer];
    if (!floor) continue;
    const cov = byLayer.get(layer);
    if (!cov) {
      failures.push(`${layer}: missing from coverage report`);
      continue;
    }
    for (const metric of ['lines', 'branches', 'functions'] as const) {
      const actual = round1(cov[metric].pct);
      if (actual < floor[metric]) {
        failures.push(`${layer} ${metric}: ${actual.toFixed(1)}% < floor ${floor[metric]}%`);
      }
    }
  }

  if (failures.length > 0) {
    console.error('Coverage ratchet FAILED — a layer dropped below its floor:');
    for (const line of failures) console.error(`  - ${line}`);
    console.error('\nAdd tests to restore coverage, or (only if intentional) lower the floor in coverage-baseline.json.');
    process.exitCode = 1;
    return;
  }

  console.log('Coverage ratchet OK — every layer is at or above its floor.');
};

main();
