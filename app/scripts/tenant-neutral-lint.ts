import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const GITHUB_ORGANISATION = /coderoadpl/gi;

const DENIED_PATTERNS: readonly { rule: string; pattern: RegExp }[] = [
  { rule: 'tenant name', pattern: /coderoad/gi },
  { rule: 'tenant domain', pattern: /coderoad\.(?:pl|example|test|localhost)/gi },
  { rule: 'legacy path shape', pattern: /(?<!\w)\/courses\/[^/\s'"`]+\/modules\//g },
  { rule: 'tenant course title', pattern: /(?:Kurs|Course) front-end od A do Z/gi },
  { rule: 'tenant course title', pattern: /Programowanie – co musisz wiedzie\u0107/gi },
  { rule: 'legacy tenant slug', pattern: /akademia-samouka/gi },
];

const IGNORED_PATHS = [
  'node_modules/',
  'dist/',
  'storybook-static/',
];

const IGNORED_FILES = [
  'app/pnpm-lock.yaml',
  'THIRD-PARTY-LICENSES.md',
];

const BINARY_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.woff', '.woff2'];

export interface TenantNeutralFinding {
  file: string;
  line: number;
  rule: string;
  match: string;
}

export interface AllowlistEntry {
  file: string;
  justification: string;
}

export const parseAllowlist = (source: string): AllowlistEntry[] =>
  source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const [file = '', justification = ''] = line.split('#');
      return { file: file.trim(), justification: justification.trim() };
    });

export const scanFile = (file: string, content: string): TenantNeutralFinding[] => {
  const findings: TenantNeutralFinding[] = [];
  content.split('\n').forEach((line, index) => {
    const masked = line.replace(GITHUB_ORGANISATION, (match) => '-'.repeat(match.length));
    for (const { rule, pattern } of DENIED_PATTERNS) {
      for (const match of masked.matchAll(pattern)) {
        findings.push({ file, line: index + 1, rule, match: match[0] });
      }
    }
  });
  return findings;
};

const gitFiles = (root: string, args: readonly string[]): string[] =>
  execFileSync('git', [...args], { cwd: root, encoding: 'utf8' }).split('\n');

const trackedFiles = (root: string): string[] =>
  [
    ...gitFiles(root, ['ls-files']),
    ...gitFiles(root, ['ls-files', '--others', '--exclude-standard']),
  ]
    .filter((file) => file !== '')
    .filter((file) => !IGNORED_PATHS.some((ignored) => file.includes(ignored)))
    .filter((file) => !IGNORED_FILES.includes(file))
    .filter((file) => !BINARY_EXTENSIONS.some((extension) => file.endsWith(extension)));

export const lintTenantNeutrality = (root: string): string[] => {
  const allowlistPath = join(root, '.tenant-neutral-allow');
  const allowlist = existsSync(allowlistPath)
    ? parseAllowlist(readFileSync(allowlistPath, 'utf8'))
    : [];
  const problems = allowlist
    .filter((entry) => entry.justification === '')
    .map((entry) => `[tenant-neutral] "${entry.file}" is allowlisted without a justification`);
  const allowed = new Set(allowlist.map((entry) => entry.file));
  const files = trackedFiles(root);
  for (const entry of allowed) {
    if (!files.includes(entry)) {
      problems.push(`[tenant-neutral] allowlisted "${entry}" is not a tracked file`);
    }
  }
  const findings = files
    .filter((file) => !allowed.has(file))
    .flatMap((file) => scanFile(file, readFileSync(join(root, file), 'utf8')));
  return [
    ...problems,
    ...findings.map((finding) =>
      `[tenant-neutral] ${finding.file}:${finding.line} ${finding.rule} "${finding.match}"`),
  ];
};

const problems = lintTenantNeutrality(join(import.meta.dirname, '..', '..'));
if (problems.length > 0) {
  process.stderr.write(`tenant-neutral-lint: ${String(problems.length)} issue(s)\n`);
  for (const problem of problems) process.stderr.write(`  ${problem}\n`);
  process.exit(1);
}
process.stdout.write('tenant-neutral-lint: OK\n');
