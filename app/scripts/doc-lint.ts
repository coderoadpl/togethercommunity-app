import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { envSchema } from '../apps/server/src/env.js';

const appRoot = join(import.meta.dirname, '..');
const repoRoot = join(appRoot, '..');
const require = createRequire(import.meta.url);
const eslintConfigPath = join(appRoot, 'eslint.config.js');
const depcruiseConfigPath = join(appRoot, '.dependency-cruiser.cjs');
const rulesDir = join(appRoot, 'eslint-plugin-together', 'rules');
const leakedDelimiters = ['</content>', '</invoke>'];

type ConfigTarget = 'eslint' | 'depcruise';

interface Enforcer {
  id: string;
  config: ConfigTarget;
}

const promisedEnforcers: Enforcer[] = [
  { id: 'boundaries/element-types', config: 'eslint' },
  { id: 'boundaries/external', config: 'eslint' },
  { id: '@typescript-eslint/no-explicit-any', config: 'eslint' },
  { id: 'no-restricted-syntax', config: 'eslint' },
  { id: 'core-domain-depends-on-nothing', config: 'depcruise' },
  { id: 'core-server-pure', config: 'depcruise' },
  { id: 'web-never-server-side', config: 'depcruise' },
  { id: 'web-features-are-islands', config: 'depcruise' },
  { id: 'web-layout-structure-only', config: 'depcruise' },
  { id: 'vercel-and-neon-only-in-adapters', config: 'depcruise' },
  { id: 'auth-provider-sdk-only-in-adapters-auth', config: 'depcruise' },
  { id: 'smtp-sdk-only-in-adapters-email', config: 'depcruise' },
];

const trackedMarkdown = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md'],
  {
    cwd: repoRoot,
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter((entry) => entry.length > 0);

const prose = trackedMarkdown.map((rel) => readFileSync(join(repoRoot, rel), 'utf8')).join('\n');
const eslintSource = readFileSync(eslintConfigPath, 'utf8');
const depcruiseModule: { forbidden: ReadonlyArray<{ name: string }> } = require(depcruiseConfigPath);
const depcruiseRuleNames = new Set(depcruiseModule.forbidden.map((rule) => rule.name));
const problems: string[] = [];

const configHas = (enforcer: Enforcer): boolean =>
  enforcer.config === 'eslint'
    ? eslintSource.includes(enforcer.id)
    : depcruiseRuleNames.has(enforcer.id);

for (const enforcer of promisedEnforcers) {
  if (!configHas(enforcer)) {
    problems.push(
      `[docs->config] "${enforcer.id}" is promised but absent from ${enforcer.config} configuration`,
    );
  }
}

const customRulePattern = /^together\/[a-z][a-z0-9-]*$/;
for (const rel of trackedMarkdown) {
  const text = readFileSync(join(repoRoot, rel), 'utf8');
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const token = match[1] ?? '';
    if (customRulePattern.test(token) && !eslintSource.includes(token)) {
      problems.push(`[docs->config] "${token}" in ${rel} is absent from eslint.config.js`);
    }
  }
}

const ruleFiles = readdirSync(rulesDir).filter(
  (name) => name.endsWith('.js') && !name.endsWith('.test.js'),
);
for (const file of ruleFiles) {
  const ruleName = basename(file, '.js');
  if (!prose.includes(`together/${ruleName}`)) {
    problems.push(`[config->docs] custom rule "together/${ruleName}" is undocumented`);
  }
  if (!existsSync(join(rulesDir, `${ruleName}.test.js`))) {
    problems.push(`[rule-test] custom rule "together/${ruleName}" has no test`);
  }
}

const envExample = readFileSync(join(appRoot, '.env.example'), 'utf8');
const envKeys = Object.keys(envSchema._def.schema.shape);
for (const key of envKeys) {
  if (!new RegExp(`^#?\\s*${key}=`, 'm').test(envExample)) {
    problems.push(`[env] "${key}" is absent from .env.example`);
  }
}

const linkPattern = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
for (const rel of trackedMarkdown) {
  const raw = readFileSync(join(repoRoot, rel), 'utf8');
  for (const delimiter of leakedDelimiters) {
    if (raw.includes(delimiter)) problems.push(`[delimiter] "${delimiter}" leaked into ${rel}`);
  }
  const proseOnly = raw.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  for (const match of proseOnly.matchAll(linkPattern)) {
    const target = match[1] ?? '';
    if (/^(https?:|mailto:|tel:|\/\/|#)/.test(target)) continue;
    const path = target.split('#')[0];
    if (!path) continue;
    const resolved = resolve(dirname(join(repoRoot, rel)), path);
    if (relative(repoRoot, resolved).startsWith('..')) continue;
    if (!existsSync(resolved)) {
      problems.push(`[link] ${rel}: "${target}" points at a missing file`);
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`doc-lint: ${String(problems.length)} issue(s)\n`);
  for (const problem of problems) process.stderr.write(`  ${problem}\n`);
  process.exit(1);
}

process.stdout.write(
  `doc-lint: OK — ${String(promisedEnforcers.length)} promised enforcers, ${String(ruleFiles.length)} custom rules, ${String(envKeys.length)} env keys, ${String(trackedMarkdown.length)} markdown files\n`,
);
