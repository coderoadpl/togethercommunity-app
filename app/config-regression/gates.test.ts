import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { ESLint, type Linter } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import packageJson from '../package.json' with { type: 'json' };

const appRoot = join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const token = `__together_probe_${String(process.pid)}_${String(Date.now())}__`;
const coreDomainDir = join('core', 'domain', token);
const coreServerDir = join('core', 'server', token);
const featureDir = join('apps', 'web', 'src', 'features', token);
const islandCoreDir = join(featureDir, 'core');
const islandDomFixture = join(islandCoreDir, 'dom.tsx');
const layoutDir = join('apps', 'web', 'src', 'components', 'layout', token);
const tenantScopeFixtureRoot = mkdtempSync(join(tmpdir(), 'together-tenant-scope-'));

const sweepRoots = [
  join(appRoot, 'core', 'domain'),
  join(appRoot, 'core', 'server'),
  join(appRoot, 'apps', 'web', 'src', 'features'),
  join(appRoot, 'apps', 'web', 'src', 'components', 'layout'),
];

const sweep = (): void => {
  for (const root of sweepRoots) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('__together_probe_')) {
        rmSync(join(root, entry.name), { recursive: true, force: true });
      }
    }
  }
};

const eslintFixtures = {
  assertion: {
    rel: join(coreDomainDir, 'assertion.ts'),
    content: 'export const forbidden = 1 as number;\n',
  },
  coreImportsAdapter: {
    rel: join(coreDomainDir, 'adapter.ts'),
    content: "import '../../../adapters/db/client.js';\n",
  },
  restrictedImport: {
    rel: join(featureDir, 'axios.ts'),
    content: "import 'axios';\n",
  },
  crossFeature: {
    rel: join(featureDir, 'cross-feature.ts'),
    content: "import '../auth/LoginPage.js';\n",
  },
  foreignDescriptor: {
    rel: join(featureDir, 'foreign-descriptor.tsx'),
    content:
      "import { useQuery } from '@tanstack/react-query';\n" +
      "import { descriptor } from './helpers/api.js';\n" +
      'export const probe = () => useQuery(descriptor);\n',
  },
  nestedSx: {
    rel: join(featureDir, 'nested-sx.tsx'),
    content:
      "import { ListItemText } from '@mui/material';\n" +
      "export const Probe = () => <ListItemText slotProps={{ primary: { 'sx': { fontWeight: 700 } } }} />;\n",
  },
  islandEvent: {
    rel: join(islandCoreDir, 'events.ts'),
    content: "export type ProbeEvent = { type: 'deleteItem' } | { type: 'itemRemoved' };\n",
  },
  islandReact: {
    rel: join(islandCoreDir, 'react.ts'),
    content: "import 'react';\nexport const probe = 1;\n",
  },
  islandApi: {
    rel: join(islandCoreDir, 'api.ts'),
    content: "import { actions } from '../../../api.js';\nexport const probe = actions;\n",
  },
} satisfies Record<string, { rel: string; content: string }>;

const depcruiseFixtures = [
  { rel: join(coreDomainDir, 'react.ts'), content: "import 'react';\n" },
  { rel: join(coreDomainDir, 'auth-sdk.ts'), content: "import 'better-auth';\n" },
  { rel: join(coreServerDir, 'contract.ts'), content: "import '../../contract/routes.js';\n" },
  { rel: join(coreServerDir, 'smtp.ts'), content: "import 'nodemailer';\n" },
  {
    rel: join(layoutDir, 'feature.ts'),
    content: "import '../../../features/auth/LoginPage.js';\n",
  },
  { rel: join(islandCoreDir, 'react-depcruise.ts'), content: "import 'react';\n" },
] satisfies Array<{ rel: string; content: string }>;

interface EslintMessage {
  ruleId: string | null;
  message: string;
}

interface EslintResult {
  filePath: string;
  messages: EslintMessage[];
}

const messagesByFixture = new Map<string, EslintMessage[]>();
const depcruiseRules = new Set<string>();
let islandTypecheckOutput = '';
let islandTypecheckStatus: number | null = null;
let tenantScopeOutput = '';
let tenantScopeStatus: number | null = null;

const writeFixture = (rel: string, content: string): string => {
  const absolute = join(appRoot, rel);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
  return absolute;
};

const runCommand = async (
  command: string,
  args: string[],
): Promise<{ status: number | null; stdout: string; stderr: string }> =>
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: appRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });

const findMessage = (
  fixture: keyof typeof eslintFixtures,
  ruleId: string,
): EslintMessage | undefined =>
  (messagesByFixture.get(eslintFixtures[fixture].rel) ?? []).find(
    (message) => message.ruleId === ruleId,
  );

beforeAll(async () => {
  sweep();
  const fixtures = Object.values(eslintFixtures);
  const eslintTargets = fixtures.map((fixture) => writeFixture(fixture.rel, fixture.content));
  for (const fixture of depcruiseFixtures) writeFixture(fixture.rel, fixture.content);
  writeFixture(islandDomFixture, 'export const forbidden = document;\n');

  const eslintRun = await runCommand(
    join(appRoot, 'node_modules', '.bin', 'eslint'),
    ['--format', 'json', ...eslintTargets],
  );
  const eslintResults: EslintResult[] = JSON.parse(eslintRun.stdout);
  for (const result of eslintResults) {
    for (const fixture of fixtures) {
      if (result.filePath === join(appRoot, fixture.rel)) {
        messagesByFixture.set(fixture.rel, result.messages);
      }
    }
  }

  const depcruiseRun = await runCommand(
    join(appRoot, 'node_modules', '.bin', 'depcruise'),
    ['--output-type', 'json', coreDomainDir, coreServerDir, islandCoreDir, layoutDir],
  );
  const report: { summary: { violations: Array<{ rule: { name: string } }> } } = JSON.parse(
    depcruiseRun.stdout,
  );
  for (const violation of report.summary.violations) {
    depcruiseRules.add(violation.rule.name);
  }

  const islandTypecheckRun = await runCommand(
    join(appRoot, 'node_modules', '.bin', 'tsc'),
    ['--noEmit', '-p', 'tsconfig.islands.json'],
  );
  islandTypecheckStatus = islandTypecheckRun.status;
  islandTypecheckOutput = `${islandTypecheckRun.stdout}${islandTypecheckRun.stderr}`;

  writeFileSync(
    join(tenantScopeFixtureRoot, 'unscoped.ts'),
    'export type DeliberatelyUnscopedRepository = { findById(id: string): Promise<unknown> };\n',
  );
  const tenantScopeRun = await runCommand(join(appRoot, 'node_modules', '.bin', 'tsx'), [
    'scripts/tenant-scope-check.ts',
    tenantScopeFixtureRoot,
  ]);
  tenantScopeStatus = tenantScopeRun.status;
  tenantScopeOutput = `${tenantScopeRun.stdout}${tenantScopeRun.stderr}`;
}, 180_000);

afterAll(() => {
  rmSync(join(appRoot, coreDomainDir), { recursive: true, force: true });
  rmSync(join(appRoot, coreServerDir), { recursive: true, force: true });
  rmSync(join(appRoot, featureDir), { recursive: true, force: true });
  rmSync(join(appRoot, layoutDir), { recursive: true, force: true });
  rmSync(tenantScopeFixtureRoot, { recursive: true, force: true });
  sweep();
});

describe('ESLint gate', () => {
  it('rejects type assertions', () => {
    expect(findMessage('assertion', 'no-restricted-syntax')).toBeDefined();
  });

  it('rejects core imports from adapters', () => {
    expect(findMessage('coreImportsAdapter', 'boundaries/element-types')).toBeDefined();
  });

  it('rejects direct HTTP libraries in web features', () => {
    expect(findMessage('restrictedImport', 'no-restricted-imports')).toBeDefined();
  });

  it('rejects cross-feature imports', () => {
    expect(findMessage('crossFeature', 'boundaries/element-types')).toBeDefined();
  });

  it('rejects descriptors from look-alike local modules', () => {
    expect(findMessage('foreignDescriptor', 'together/query-descriptors-only')).toBeDefined();
  });

  it('rejects reserved styling in quoted nested sx objects', () => {
    expect(findMessage('nestedSx', 'together/sx-layout-only')).toBeDefined();
  });

  it('rejects imperative island event names', () => {
    expect(findMessage('islandEvent', 'together/event-suffix-taxonomy')).toBeDefined();
  });

  it('rejects React imports from island cores', () => {
    expect(findMessage('islandReact', 'no-restricted-imports')).toBeDefined();
  });

  it('rejects parent-relative imports from island cores', () => {
    expect(findMessage('islandApi', 'no-restricted-imports')).toBeDefined();
  });
});

describe('Dependency Cruiser gate', () => {
  it('rejects frameworks in core', () => {
    expect(depcruiseRules.has('no-frameworks-in-core')).toBe(true);
  });

  it('rejects auth SDKs outside the auth adapter', () => {
    expect(depcruiseRules.has('auth-provider-sdk-only-in-adapters-auth')).toBe(true);
  });

  it('keeps core server isolated from core contract', () => {
    expect(depcruiseRules.has('core-server-pure')).toBe(true);
  });

  it('rejects mail SDKs outside the email adapter', () => {
    expect(depcruiseRules.has('smtp-sdk-only-in-adapters-email')).toBe(true);
  });

  it('keeps web layouts structure-only', () => {
    expect(depcruiseRules.has('web-layout-structure-only')).toBe(true);
  });

  it('keeps island cores framework-agnostic', () => {
    expect(depcruiseRules.has('island-core-is-framework-agnostic')).toBe(true);
  });

  it('keeps island cores portable', () => {
    expect(depcruiseRules.has('island-core-is-portable')).toBe(true);
  });

  it('keeps guarded rules at error severity', () => {
    const config: { forbidden: Array<{ name: string; severity: string }> } = require(
      join(appRoot, '.dependency-cruiser.cjs'),
    );
    const severity = new Map(config.forbidden.map((rule) => [rule.name, rule.severity]));
    for (const name of [
      'no-circular',
      'core-domain-depends-on-nothing',
      'core-server-pure',
      'core-contract-only-domain',
      'core-client-never-server-side',
      'adapters-never-import-apps',
      'web-never-server-side',
      'web-layout-structure-only',
      'island-core-is-framework-agnostic',
      'island-core-is-portable',
      'vercel-and-neon-only-in-adapters',
      'no-frameworks-in-core',
      'auth-provider-sdk-only-in-adapters-auth',
      'smtp-sdk-only-in-adapters-email',
    ]) {
      expect(severity.get(name)).toBe('error');
    }
  });
});

describe('Island typecheck gate', () => {
  it('rejects DOM references from TypeScript JSX island cores', () => {
    expect(islandTypecheckStatus).not.toBe(0);
    expect(islandTypecheckOutput).toContain(islandDomFixture);
    expect(islandTypecheckOutput).toContain("Cannot find name 'document'");
  });
});

describe('Tenant scope gate', () => {
  it('rejects an unscoped repository through the CLI exit path', () => {
    expect(tenantScopeStatus).toBe(1);
    expect(tenantScopeOutput).toContain(
      'DeliberatelyUnscopedRepository.findById must take tenantId as its first parameter',
    );
  });

  it('remains a stage of the aggregate check gate', () => {
    const stages = packageJson.scripts.check
      .split('&&')
      .map((stage) => stage.trim().replace(/^pnpm run /, ''));
    expect(stages).toContain('tenant-scope-check');
  });
});

describe('Custom plugin registration', () => {
  const severityOf = (
    entry: Linter.RuleEntry | undefined,
  ): Linter.RuleSeverity | undefined => {
    if (entry === undefined) return undefined;
    return Array.isArray(entry) ? entry[0] : entry;
  };

  it('keeps descriptor and sx rules enabled as errors', async () => {
    const eslint = new ESLint({ cwd: appRoot });
    const config: Linter.Config = await eslint.calculateConfigForFile(
      join('apps', 'web', 'src', 'features', 'auth', 'LoginPage.tsx'),
    );
    expect(severityOf(config.rules?.['together/query-descriptors-only'])).toBe(2);
    expect(severityOf(config.rules?.['together/sx-layout-only'])).toBe(2);
  }, 30_000);

  it('keeps the sx baseline empty', () => {
    const baseline: unknown = JSON.parse(
      readFileSync(
        join(appRoot, 'eslint-plugin-together', 'sx-layout-baseline.json'),
        'utf8',
      ),
    );
    expect(baseline).toEqual({});
  });
});
