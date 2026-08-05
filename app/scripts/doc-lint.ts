import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { envSchema } from '../apps/server/src/env.js';
import packageJson from '../package.json' with { type: 'json' };
import { collectReleaseVersionProblems } from './release-version-lint.js';

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

const vitestFiles = execFileSync(
  process.execPath,
  [require.resolve('vitest/vitest.mjs'), 'list', '--filesOnly'],
  {
    cwd: appRoot,
    encoding: 'utf8',
  },
)
  .split('\n')
  .map((entry) => entry.replace(/^\[[^\]]+\]\s+/, '').trim())
  .filter((entry) => entry.length > 0);
const countValues: Readonly<Record<string, number>> = {
  'test-files': new Set(vitestFiles).size,
};
const countTokenPattern = /<!--count:([a-z0-9-]+)-->(\d+)<!--\/count-->/g;
const numericTestCountPatterns = [
  /\b\d+\s+test files?\b/i,
  /\b\d+\s+plik(?:i|ów)? testow(?:e|y|ych)\b/i,
];
const numericTestCountAllowlist = ['tasks/', 'app/tasks/'];
const requiredCountTokens: Readonly<Record<string, readonly string[]>> = {
  'app/README.md': ['test-files'],
};
const checkChain = packageJson.scripts.check
  .split('&&')
  .map((stage) => stage.trim().replace(/^pnpm run /, ''));
const checkClaimPattern =
  /- `pnpm run check` = ([\s\S]*?) —\s+the \*\*static\*\* gate\./;

const markdownFiles = new Map(
  trackedMarkdown.map((rel) => [rel, readFileSync(join(repoRoot, rel), 'utf8')]),
);
const prose = [...markdownFiles.values()].join('\n');
const eslintSource = readFileSync(eslintConfigPath, 'utf8');
const depcruiseModule: { forbidden: ReadonlyArray<{ name: string }> } = require(depcruiseConfigPath);
const depcruiseRuleNames = new Set(depcruiseModule.forbidden.map((rule) => rule.name));
const problems: string[] = [];
const countTokensByFile = new Map<string, Set<string>>();
let countTokensSeen = 0;

const requiredReleaseVersionRegions = ['app/docs/decisions/0011-version-surfaces.md'];
const appVersion = packageJson.version;
const releaseVersionResult = collectReleaseVersionProblems(
  markdownFiles,
  appVersion,
  requiredReleaseVersionRegions,
);
problems.push(...releaseVersionResult.problems);

const claudeRules = readFileSync(join(appRoot, 'CLAUDE.md'), 'utf8');
const checkClaim = checkClaimPattern.exec(claudeRules);
if (checkClaim === null) {
  problems.push('[check-chain] app/CLAUDE.md must enumerate the pnpm run check stages');
} else {
  const claimedStages = [...(checkClaim[1] ?? '').matchAll(/`([^`]+)`/g)].map(
    (match) => match[1] ?? '',
  );
  const expected = [...checkChain].sort();
  const claimed = [...claimedStages].sort();
  if (
    expected.length !== claimed.length ||
    expected.some((stage, index) => stage !== claimed[index])
  ) {
    problems.push(
      `[check-chain] app/CLAUDE.md claims [${claimedStages.join(', ')}], package.json defines [${checkChain.join(', ')}]`,
    );
  }
}

for (const [rel, text] of markdownFiles) {
  const seen = new Set<string>();
  countTokensByFile.set(rel, seen);
  for (const match of text.matchAll(countTokenPattern)) {
    countTokensSeen += 1;
    const name = match[1] ?? '';
    const claimed = Number(match[2]);
    const actual = countValues[name];
    if (actual === undefined) {
      problems.push(
        `[count] unknown counter "${name}" in ${rel}; valid counters: ${Object.keys(countValues).join(', ')}`,
      );
      continue;
    }
    seen.add(name);
    if (actual !== claimed) {
      problems.push(
        `[count] ${rel}: count:${name} claims ${String(claimed)} but Vitest discovers ${String(actual)}`,
      );
    }
  }
  if (!numericTestCountAllowlist.some((prefix) => rel.startsWith(prefix))) {
    const withoutTokens = text.replace(countTokenPattern, '');
    for (const pattern of numericTestCountPatterns) {
      if (pattern.test(withoutTokens)) {
        problems.push(`[count] ${rel} states a numeric test count without a count token`);
      }
    }
  }
}

for (const [rel, required] of Object.entries(requiredCountTokens)) {
  const seen = countTokensByFile.get(rel);
  if (seen === undefined) {
    problems.push(`[count] required token surface ${rel} is not tracked markdown`);
    continue;
  }
  for (const name of required) {
    if (!seen.has(name)) {
      problems.push(`[count] ${rel} must carry count:${name}`);
    }
  }
}

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
for (const [rel, text] of markdownFiles) {
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

const productionProbe = envSchema.safeParse({ NODE_ENV: 'production' });
if (productionProbe.success) {
  problems.push('[env-production] production schema probe unexpectedly passed');
} else {
  const productionRequiredKeys = Object.keys(productionProbe.error.flatten().fieldErrors);
  const productionTemplates = readdirSync(appRoot)
    .filter((name) => name.startsWith('.env') && name.endsWith('.example'))
    .map((name) => [name, readFileSync(join(appRoot, name), 'utf8')] as const)
    .filter(([, contents]) => /^(?:NODE_ENV|APP_ENV)=production$/m.test(contents));
  for (const [name, contents] of productionTemplates) {
    for (const key of productionRequiredKeys) {
      if (!new RegExp(`^${key}=`, 'm').test(contents)) {
        problems.push(`[env-production] "${key}" is absent from ${name}`);
      }
    }
  }
}

const linkPattern = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
for (const [rel, raw] of markdownFiles) {
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
  `doc-lint: OK — ${String(promisedEnforcers.length)} promised enforcers, ${String(ruleFiles.length)} custom rules, ${String(countTokensSeen)} count tokens, ${String(releaseVersionResult.claimsSeen)} release-version claims at ${appVersion}, ${String(envKeys.length)} env keys, ${String(trackedMarkdown.length)} markdown files\n`,
);
