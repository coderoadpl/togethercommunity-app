import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { LAYERS, readLayerCoverage, round1, type Layer, type LayerCoverage } from './coverage-layers.js';

const summaryPath = fileURLToPath(new URL('../coverage/coverage-summary.json', import.meta.url));
const reportPath = fileURLToPath(new URL('../../tasks/coverage-report.md', import.meta.url));
const baselinePath = fileURLToPath(new URL('../coverage-baseline.json', import.meta.url));

const START = '<!-- COVERAGE:START -->';
const END = '<!-- COVERAGE:END -->';

const pct = (value: number): string => `${round1(value).toFixed(1)}%`;

const row = (label: string, cov: LayerCoverage): string =>
  `| ${label} | ${cov.files} | ${pct(cov.lines.pct)} (${cov.lines.covered}/${cov.lines.total}) | ${pct(
    cov.branches.pct,
  )} (${cov.branches.covered}/${cov.branches.total}) | ${pct(cov.functions.pct)} (${cov.functions.covered}/${
    cov.functions.total
  }) |`;

const buildTable = (byLayer: Map<Layer, LayerCoverage>): string => {
  const header = [
    '| Layer | Files | Lines | Branches | Functions |',
    '| --- | --- | --- | --- | --- |',
  ];
  const body: string[] = [];
  const totals: LayerCoverage = {
    lines: { total: 0, covered: 0, pct: 0 },
    branches: { total: 0, covered: 0, pct: 0 },
    functions: { total: 0, covered: 0, pct: 0 },
    files: 0,
  };
  for (const layer of LAYERS) {
    const cov = byLayer.get(layer);
    if (!cov || cov.files === 0) continue;
    body.push(row(layer, cov));
    totals.files += cov.files;
    for (const key of ['lines', 'branches', 'functions'] as const) {
      totals[key].total += cov[key].total;
      totals[key].covered += cov[key].covered;
    }
  }
  for (const key of ['lines', 'branches', 'functions'] as const) {
    totals[key].pct = totals[key].total === 0 ? 100 : (totals[key].covered / totals[key].total) * 100;
  }
  return [...header, ...body, row('**TOTAL**', totals)].join('\n');
};

const writeBaseline = (byLayer: Map<Layer, LayerCoverage>): void => {
  const floors: Record<string, { lines: number; branches: number; functions: number }> = {};
  for (const layer of LAYERS) {
    const cov = byLayer.get(layer);
    if (!cov || cov.files === 0 || layer === 'other') continue;
    floors[layer] = {
      lines: Math.floor(cov.lines.pct),
      branches: Math.floor(cov.branches.pct),
      functions: Math.floor(cov.functions.pct),
    };
  }
  const payload = {
    note: 'Per-layer coverage floors (rounded down from achieved). Enforced by `npm run coverage:check`. Raise a floor only after `npm run coverage` shows the layer safely above the new number.',
    generatedFrom: 'npm run coverage',
    floors,
  };
  writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nWrote coverage floors to ${baselinePath}`);
};

const main = (): void => {
  if (!existsSync(summaryPath)) {
    console.error(`Coverage summary not found at ${summaryPath}. Run \`npm run coverage\` first.`);
    process.exitCode = 1;
    return;
  }
  const byLayer = readLayerCoverage(summaryPath);
  const table = buildTable(byLayer);
  console.log(table);

  if (existsSync(reportPath)) {
    const doc = readFileSync(reportPath, 'utf8');
    const start = doc.indexOf(START);
    const end = doc.indexOf(END);
    if (start !== -1 && end !== -1 && end > start) {
      const next = `${doc.slice(0, start + START.length)}\n\n${table}\n\n${doc.slice(end)}`;
      writeFileSync(reportPath, next);
      console.log(`\nUpdated table in ${reportPath}`);
    }
  }

  if (process.argv.includes('--write-baseline')) writeBaseline(byLayer);
};

main();
