import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const appRoot = join(import.meta.dirname, '..');
const repoRoot = join(appRoot, '..');
const polishDiacritics = /[\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017a\u017c\u0104\u0106\u0118\u0141\u0143\u00d3\u015a\u0179\u017b]/;
const skippedExtensions = new Set([
  '.avif',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.lock',
  '.pdf',
  '.png',
  '.webp',
  '.woff',
  '.woff2',
]);
const skippedFiles = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);
const legalPhrases = [
  'ustawy o podatku od towarów i usług',
  'rabat kuponowy',
];

const isAllowedFile = (path: string): boolean =>
  path === 'CLA.md' ||
  path === 'app/apps/web/src/i18n/pl.ts' ||
  path.endsWith('.pl.ts') ||
  path.startsWith('app/adapters/invoicing/xsd/') ||
  path.startsWith('app/drizzle/') && path.endsWith('.sql') ||
  path === 'app/adapters/invoicing/ksef-pdf.ts';

const stripAllowedPhrases = (line: string): string =>
  legalPhrases.reduce((current, phrase) => current.replaceAll(phrase, ''), line);

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\0')
  .filter((entry) => entry.length > 0);

const problems: string[] = [];

for (const file of trackedFiles) {
  if (isAllowedFile(file)) continue;
  if (skippedFiles.has(file)) continue;
  if (skippedExtensions.has(extname(file).toLowerCase())) continue;

  const contents = readFileSync(join(repoRoot, file), 'utf8');
  const lines = contents.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (polishDiacritics.test(stripAllowedPhrases(line))) {
      problems.push(`${file}:${String(index + 1)}: Polish diacritic outside language allowlist`);
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`language-lint: ${String(problems.length)} issue(s)\n`);
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.exit(1);
}

process.stdout.write(`language-lint: OK — ${String(trackedFiles.length)} tracked file(s)\n`);
