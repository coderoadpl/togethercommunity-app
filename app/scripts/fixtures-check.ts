import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { rootDir, run, tsxBin } from './server-harness.js';

const baseline = resolve(process.argv[2] ?? join(rootDir, 'apps/web/src/stories/fixtures'));
const temporary = mkdtempSync(join(tmpdir(), 'together-fixtures-check-'));
try {
  const recorded = await run(tsxBin, ['scripts/fixtures-record.ts', temporary]);
  if (recorded.code !== 0) throw new Error(`Fixture recording failed:
${recorded.stdout}${recorded.stderr}`);
  const names = [...new Set([...readdirSync(baseline), ...readdirSync(temporary)])].sort();
  const hash = (directory: string, name: string): string => {
    const path = join(directory, name);
    return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'missing';
  };
  const differences = names.flatMap((name) => {
    const expected = hash(baseline, name);
    const actual = hash(temporary, name);
    return expected === actual ? [] : [`${name}: baseline=${expected} recorded=${actual}`];
  });
  if (differences.length > 0) {
    console.error(differences.join('\n'));
    process.exitCode = 1;
    console.error('fixtures-check: FAIL — recorded fixtures drifted from the baseline');
  } else {
    console.log('fixtures-check: PASS — fresh recording matches the baseline byte-for-byte');
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
