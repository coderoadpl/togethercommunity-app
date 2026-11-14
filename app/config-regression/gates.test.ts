import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { ESLint, type Linter } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import packageJson from '../package.json' with { type: 'json' };

const appRoot = join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'together-config-regression-')));
const fixtureAppRoot = join(fixtureRoot, 'app');
const token = `__together_probe_${String(process.pid)}_${String(Date.now())}__`;
const coreDomainDir = join('core', 'domain', token);
const coreServerDir = join('core', 'server', token);
const webDir = join('apps', 'web', 'src', token);
const featureDir = join('apps', 'web', 'src', 'features', token);
const islandCoreDir = join(featureDir, 'core');
const islandDomFixture = join(islandCoreDir, 'dom.tsx');
const layoutDir = join('apps', 'web', 'src', 'components', 'layout', token);
const tenantScopeFixtureRoot = mkdtempSync(join(tmpdir(), 'together-tenant-scope-'));

const eslintFixtures = {
  assertion: {
    rel: join(coreDomainDir, 'assertion.ts'),
    content: 'export const forbidden = 1 as number;\n',
  },
  coreImportsAdapter: {
    rel: join(coreDomainDir, 'adapter.ts'),
    content: "import '../../../adapters/db/client.js';\n",
  },
  consoleOutsideBootstrap: {
    rel: join(webDir, 'console.ts'),
    content: "console.log('probe');\n",
  },
  genericQuery: {
    rel: join(webDir, 'generic-query.ts'),
    content:
      "import { useQuery } from '@tanstack/react-query';\n" +
      "import { actions } from '../api.js';\n" +
      'export const useProbe = () => useQuery<number>(actions.me);\n',
  },
  coreExternal: {
    rel: join(coreDomainDir, 'query-core.ts'),
    content: "import '@tanstack/query-core';\n",
  },
  layoutReExport: {
    rel: join(layoutDir, 'ui-export.ts'),
    content: "export { ConfirmDialog } from '../../ui/ConfirmDialog.js';\n",
  },
  forbiddenDynamicImport: {
    rel: join(coreDomainDir, 'dynamic-adapter.ts'),
    content: "export const loadAdapter = () => import('../../../adapters/db/client.js');\n",
  },
  invoicingExternal: {
    rel: join('adapters', 'invoicing', token, 'external.ts'),
    content: "import 'react';\n",
  },
  notificationsExternal: {
    rel: join('adapters', 'notifications', token, 'external.ts'),
    content: "import 'react';\n",
  },
  qrExternal: {
    rel: join('adapters', 'qr', token, 'external.ts'),
    content: "import 'react';\n",
  },
  schedulerExternal: {
    rel: join('adapters', 'scheduler', token, 'external.ts'),
    content: "import 'react';\n",
  },
  unknownProductFile: {
    rel: join('adapters', token, 'unclassified.ts'),
    content: 'export const probe = 1;\n',
  },
  unknownApiFile: {
    rel: join('api', token, 'unclassified.ts'),
    content: 'export const probe = 1;\n',
  },
  vercelIndex: {
    rel: join('api', 'index.ts'),
    content:
      "export { entry } from '../apps/server/src/entry.vercel.js';\n" +
      "import '../apps/server/src/composition.js';\n" +
      "import 'react';\n" +
      "import '@vercel/functions';\n" +
      "import '@neondatabase/serverless';\n",
  },
  vercelPlatformReset: {
    rel: join('api', 'platform-reset.ts'),
    content:
      "export { entry } from '../apps/server/src/entry.vercel.js';\n" +
      "import '../apps/server/src/composition.js';\n" +
      "import 'react';\n" +
      "import '@vercel/functions';\n" +
      "import '@neondatabase/serverless';\n",
  },
  platformEntryTest: {
    rel: join('apps', 'server', 'src', 'entry.vercel.test.ts'),
    content:
      "import 'vitest';\n" +
      "import './composition.js';\n" +
      "export const loadEntry = () => import('./entry.vercel.js');\n" +
      "import '@vercel/functions';\n" +
      "import '@neondatabase/serverless';\n",
  },
  otherServerTest: {
    rel: join('apps', 'server', 'src', 'other.test.ts'),
    content:
      "export const loadEntry = () => import('./entry.vercel.js');\n" +
      "import '@vercel/functions';\n" +
      "import '@neondatabase/serverless';\n",
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

const adapterDepcruiseCases = [
  { adapter: 'invoicing', suffix: 'ts', externalRule: 'adapter-invoicing-external-allowlist', builtinRule: 'adapter-invoicing-builtin-allowlist' },
  { adapter: 'invoicing', suffix: 'test.ts', externalRule: 'adapter-invoicing-test-external-allowlist', builtinRule: 'adapter-invoicing-test-builtin-allowlist' },
  { adapter: 'notifications', suffix: 'ts', externalRule: 'adapter-notifications-external-allowlist', builtinRule: 'notification-qr-scheduler-no-builtins' },
  { adapter: 'notifications', suffix: 'test.ts', externalRule: 'adapter-notifications-test-external-allowlist', builtinRule: 'notification-qr-scheduler-no-builtins' },
  { adapter: 'qr', suffix: 'ts', externalRule: 'adapter-qr-external-allowlist', builtinRule: 'notification-qr-scheduler-no-builtins' },
  { adapter: 'qr', suffix: 'test.ts', externalRule: 'adapter-qr-test-external-allowlist', builtinRule: 'notification-qr-scheduler-no-builtins' },
  { adapter: 'scheduler', suffix: 'ts', externalRule: 'adapter-scheduler-external-allowlist', builtinRule: 'notification-qr-scheduler-no-builtins' },
  { adapter: 'scheduler', suffix: 'test.ts', externalRule: 'adapter-scheduler-external-allowlist', builtinRule: 'notification-qr-scheduler-no-builtins' },
];

const forbiddenDepcruiseEdges = [
  {
    rel: join(layoutDir, 'ui-import.ts'),
    dependency: '../../ui/ConfirmDialog.js',
    dependencyType: 'local',
    rule: 'web-layout-structure-only',
  },
  {
    rel: join(layoutDir, 'lib-import.ts'),
    dependency: '../../../lib/probe.js',
    dependencyType: 'local',
    rule: 'web-layout-structure-only',
  },
  ...adapterDepcruiseCases.flatMap(({ adapter, suffix, externalRule, builtinRule }) => [
    {
      rel: join('adapters', adapter, token, `npm-depcruise.${suffix}`),
      dependency: 'react',
      dependencyType: 'npm',
      rule: externalRule,
    },
    ...['net', 'node:net'].map((dependency) => ({
      rel: join('adapters', adapter, token, `${dependency.replace(':', '-')}-depcruise.${suffix}`),
      dependency,
      dependencyType: 'core',
      rule: builtinRule,
    })),
  ]),
];

const allowedDepcruiseEdges = [
  ...['ts', 'test.ts'].flatMap((suffix) => ['crypto', 'node:crypto'].map((dependency) => ({
    rel: join('adapters', 'invoicing', token, `${dependency.replace(':', '-')}-allowed.${suffix}`),
    dependency,
    dependencyType: 'core',
  }))),
  {
    rel: join(layoutDir, 'layout-allowed.ts'),
    dependency: './leaf.js',
    dependencyType: 'local',
  },
  {
    rel: join(layoutDir, 'theme-allowed.ts'),
    dependency: '../../../theme.js',
    dependencyType: 'local',
  },
];

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
  ...[...forbiddenDepcruiseEdges, ...allowedDepcruiseEdges].map(({ rel, dependency }) => ({
    rel,
    content: `import '${dependency}';\n`,
  })),
] satisfies Array<{ rel: string; content: string }>;

interface EslintMessage {
  ruleId: string | null;
  message: string;
}

interface EslintResult {
  filePath: string;
  messages: EslintMessage[];
}

interface DepcruiseViolation {
  from: string;
  to: string;
  rule: { name: string; severity: string };
}

interface DepcruiseModule {
  source: string;
  dependencies: Array<{ resolved: string }>;
}

const messagesByFixture = new Map<string, EslintMessage[]>();
const depcruiseRules = new Set<string>();
let depcruiseViolations: DepcruiseViolation[] = [];
let depcruiseModules: DepcruiseModule[] = [];
let islandTypecheckOutput = '';
let islandTypecheckStatus: number | null = null;
let tenantScopeOutput = '';
let tenantScopeStatus: number | null = null;

const copyFixtureFile = (rel: string): void => {
  const target = join(fixtureAppRoot, rel);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(appRoot, rel), target, { recursive: true });
};

const createFixtureWorkspace = (): void => {
  mkdirSync(fixtureAppRoot, { recursive: true });
  for (const rel of [
    '.dependency-cruiser.cjs',
    'eslint.config.js',
    'eslint-plugin-together',
    'package.json',
    'tsconfig.islands.json',
    'tsconfig.json',
  ]) {
    copyFixtureFile(rel);
  }
  const nodeModules = join(appRoot, 'node_modules');
  if (existsSync(nodeModules)) symlinkSync(nodeModules, join(fixtureAppRoot, 'node_modules'), 'dir');
};

const writeFixture = (rel: string, content: string): string => {
  const absolute = join(fixtureAppRoot, rel);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
  return absolute;
};

const runCommand = async (
  command: string,
  args: string[],
  cwd = fixtureAppRoot,
): Promise<{ status: number | null; stdout: string; stderr: string }> =>
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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
  createFixtureWorkspace();
  writeFixture(join('adapters', 'db', 'client.ts'), 'export const clientProbe = 1;\n');
  writeFixture(join('apps', 'server', 'src', 'entry.vercel.ts'), 'export const entry = 1;\n');
  writeFixture(join('apps', 'server', 'src', 'composition.ts'), 'export const composition = 1;\n');
  writeFixture(
    join('apps', 'web', 'src', 'components', 'ui', 'ConfirmDialog.tsx'),
    'export const ConfirmDialog = () => null;\n',
  );
  writeFixture(join('apps', 'web', 'src', 'api.ts'), 'export const actions = {};\n');
  writeFixture(join('apps', 'web', 'src', 'lib', 'probe.ts'), 'export const probe = 1;\n');
  writeFixture(join('apps', 'web', 'src', 'theme.ts'), 'export const theme = {};\n');
  writeFixture(join(layoutDir, 'leaf.ts'), 'export const leaf = 1;\n');
  writeFixture(
    join('apps', 'web', 'src', 'features', 'auth', 'LoginPage.tsx'),
    'export const LoginPage = () => null;\n',
  );
  writeFixture(join('core', 'contract', 'routes.ts'), 'export const routesProbe = 1;\n');
  const fixtures = Object.values(eslintFixtures);
  const eslintTargets = fixtures.map((fixture) => writeFixture(fixture.rel, fixture.content));
  writeFixture(
    join(featureDir, 'helpers', 'api.ts'),
    "export const descriptor = { queryKey: ['probe'], call: () => Promise.resolve(null) };\n",
  );
  for (const fixture of depcruiseFixtures) writeFixture(fixture.rel, fixture.content);
  writeFixture(islandDomFixture, 'export const forbidden = document;\n');

  const eslintRun = await runCommand(
    join(fixtureAppRoot, 'node_modules', '.bin', 'eslint'),
    ['--format', 'json', ...eslintTargets],
  );
  const eslintResults: EslintResult[] = JSON.parse(eslintRun.stdout);
  for (const result of eslintResults) {
    for (const fixture of fixtures) {
      if (result.filePath.endsWith(fixture.rel)) {
        messagesByFixture.set(fixture.rel, result.messages);
      }
    }
  }

  const depcruiseRun = await runCommand(
    join(fixtureAppRoot, 'node_modules', '.bin', 'depcruise'),
    [
      '--output-type', 'json', coreDomainDir, coreServerDir, islandCoreDir, layoutDir,
      ...new Set(adapterDepcruiseCases.map(({ adapter }) => join('adapters', adapter, token))),
    ],
  );
  const report: {
    modules: DepcruiseModule[];
    summary: { violations: DepcruiseViolation[] };
  } = JSON.parse(depcruiseRun.stdout);
  depcruiseViolations = report.summary.violations;
  depcruiseModules = report.modules;
  for (const violation of depcruiseViolations) {
    depcruiseRules.add(violation.rule.name);
  }

  const islandTypecheckRun = await runCommand(
    join(fixtureAppRoot, 'node_modules', '.bin', 'tsc'),
    ['--noEmit', '-p', 'tsconfig.islands.json'],
  );
  islandTypecheckStatus = islandTypecheckRun.status;
  islandTypecheckOutput = `${islandTypecheckRun.stdout}${islandTypecheckRun.stderr}`;
  writeFileSync(
    join(tenantScopeFixtureRoot, 'unscoped.ts'),
    'export type DeliberatelyUnscopedRepository = { findById(id: string): Promise<unknown> };\n',
  );
  const tenantScopeRun = await runCommand(
    join(appRoot, 'node_modules', '.bin', 'tsx'),
    ['scripts/tenant-scope-check.ts', tenantScopeFixtureRoot],
    appRoot,
  );
  tenantScopeStatus = tenantScopeRun.status;
  tenantScopeOutput = `${tenantScopeRun.stdout}${tenantScopeRun.stderr}`;
}, 180_000);

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(tenantScopeFixtureRoot, { recursive: true, force: true });
});

describe('ESLint gate', () => {
  it('rejects type assertions', () => {
    expect(findMessage('assertion', 'no-restricted-syntax')).toBeDefined();
  });

  it('rejects core imports from adapters', () => {
    expect(findMessage('coreImportsAdapter', 'boundaries/element-types')).toBeDefined();
  });

  it('rejects console logging outside web bootstrap', () => {
    expect(findMessage('consoleOutsideBootstrap', 'no-console')?.message).toContain(
      'Unexpected console statement',
    );
  });

  it('rejects explicit useQuery type arguments outside features', () => {
    expect(findMessage('genericQuery', 'no-restricted-syntax')?.message).toContain(
      'No explicit type arguments',
    );
  });

  it('rejects non-zod externals in core domain through default-deny', () => {
    expect(findMessage('coreExternal', 'boundaries/external')?.message).toContain(
      'core-domain is not allowed to import external package "@tanstack/query-core"',
    );
  });

  it('rejects layout re-exports from UI components', () => {
    expect(findMessage('layoutReExport', 'boundaries/element-types')?.message).toContain(
      'web-layout is not allowed to import web-ui',
    );
  });

  it('rejects dynamic imports across forbidden boundaries', () => {
    expect(findMessage('forbiddenDynamicImport', 'boundaries/element-types')?.message).toContain(
      'core-domain is not allowed to import adapter-db',
    );
  });

  it.each([
    ['invoicingExternal', 'adapter-invoicing'],
    ['notificationsExternal', 'adapter-notifications'],
    ['qrExternal', 'adapter-qr'],
    ['schedulerExternal', 'adapter-scheduler'],
  ] as const)('rejects unapproved externals in %s', (fixture, element) => {
    expect(findMessage(fixture, 'boundaries/external')?.message).toContain(
      `${element} is not allowed to import external package "react"`,
    );
  });

  it('rejects new unclassified product directories', () => {
    expect(findMessage('unknownProductFile', 'boundaries/no-unknown-files')?.message).toContain(
      'File is not of any known element type',
    );
  });

  it('rejects unclassified API files', () => {
    expect(findMessage('unknownApiFile', 'boundaries/no-unknown-files')?.message).toContain(
      'File is not of any known element type',
    );
  });

  it.each(['vercelIndex', 'vercelPlatformReset'] as const)(
    'classifies %s and allows only its platform entry dependency',
    (fixture) => {
      const messages = messagesByFixture.get(eslintFixtures[fixture].rel);
      expect(messages).toBeDefined();
      expect(findMessage(fixture, 'boundaries/no-unknown-files')).toBeUndefined();
      expect(messages?.filter(({ ruleId }) => ruleId === 'boundaries/element-types')).toEqual([
        expect.objectContaining({
          message: expect.stringContaining('vercel-function is not allowed to import app-server'),
        }),
      ]);
      expect(messages?.filter(({ ruleId }) => ruleId === 'boundaries/external')).toEqual(
        ['react', '@vercel/functions', '@neondatabase/serverless'].map((dependency) =>
          expect.objectContaining({
            message: expect.stringContaining(
              `vercel-function is not allowed to import external package "${dependency}"`,
            ),
          }),
        ),
      );
    },
  );

  it('allows only the exact entry test to reach the platform entry and app-server', () => {
    const messages = messagesByFixture.get(eslintFixtures.platformEntryTest.rel);
    expect(messages).toBeDefined();
    expect(messages?.filter(({ ruleId }) => ruleId === 'boundaries/element-types')).toEqual([]);
    expect(findMessage('otherServerTest', 'boundaries/element-types')?.message).toContain(
      'app-server is not allowed to import platform-entry',
    );
  });

  it.each([
    ['platformEntryTest', 'platform-entry-test'],
    ['otherServerTest', 'app-server'],
  ] as const)('does not grant %s a platform vendor exemption', (fixture, element) => {
    const messages = messagesByFixture.get(eslintFixtures[fixture].rel);
    expect(messages?.filter(({ ruleId }) => ruleId === 'boundaries/external')).toMatchObject([
      {
        ruleId: 'boundaries/external',
        message: expect.stringContaining(
          `${element} is not allowed to import external package "@vercel/functions"`,
        ),
      },
      {
        ruleId: 'boundaries/external',
        message: expect.stringContaining(
          `${element} is not allowed to import external package "@neondatabase/serverless"`,
        ),
      },
    ]);
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
  it.each(forbiddenDepcruiseEdges)(
    'rejects $rel → $dependency with $rule',
    ({ rel, dependency, dependencyType, rule }) => {
      const edges = depcruiseModules.find(({ source }) => source === rel)?.dependencies;
      expect(edges).toEqual([
        expect.objectContaining({
          module: dependency.replace(/^node:/, ''),
          ...(dependency.startsWith('node:') ? { protocol: 'node:' } : {}),
          dependencyTypes: expect.arrayContaining([dependencyType]),
          couldNotResolve: false,
          valid: false,
        }),
      ]);
      expect(depcruiseViolations).toContainEqual(expect.objectContaining({
        from: rel,
        to: edges?.[0]?.resolved,
        rule: { name: rule, severity: 'error' },
      }));
    },
  );

  it.each(allowedDepcruiseEdges)(
    'allows $rel → $dependency without violations',
    ({ rel, dependency, dependencyType }) => {
      expect(depcruiseModules.find(({ source }) => source === rel)?.dependencies).toEqual([
        expect.objectContaining({
          module: dependency.replace(/^node:/, ''),
          ...(dependency.startsWith('node:') ? { protocol: 'node:' } : {}),
          dependencyTypes: expect.arrayContaining([dependencyType]),
          couldNotResolve: false,
          valid: true,
        }),
      ]);
      expect(depcruiseViolations.filter(({ from }) => from === rel)).toEqual([]);
    },
  );

  it('rejects frameworks in core', () => {
    expect(depcruiseRules.has('no-frameworks-in-core')).toBe(true);
  });

  it('rejects non-zod externals in core domain', () => {
    expect(depcruiseRules.has('core-domain-external-allowlist')).toBe(true);
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
      join(fixtureAppRoot, '.dependency-cruiser.cjs'),
    );
    const severity = new Map(config.forbidden.map((rule) => [rule.name, rule.severity]));
    for (const name of [
      'no-circular',
      'core-domain-depends-on-nothing',
      'core-domain-external-allowlist',
      'core-server-pure',
      'core-contract-only-domain',
      'core-client-never-server-side',
      'adapters-never-import-apps',
      'web-never-server-side',
      'web-features-are-islands',
      'web-layout-structure-only',
      'island-core-is-framework-agnostic',
      'island-core-is-portable',
      'vercel-and-neon-only-in-adapters',
      'no-frameworks-in-core',
      'auth-provider-sdk-only-in-adapters-auth',
      'smtp-sdk-only-in-adapters-email',
      ...new Set(adapterDepcruiseCases.flatMap(({ externalRule, builtinRule }) => [externalRule, builtinRule])),
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
    const eslint = new ESLint({ cwd: fixtureAppRoot });
    const config: Linter.Config = await eslint.calculateConfigForFile(
      join('apps', 'web', 'src', 'features', 'auth', 'LoginPage.tsx'),
    );
    expect(severityOf(config.rules?.['together/query-descriptors-only'])).toBe(2);
    expect(severityOf(config.rules?.['together/sx-layout-only'])).toBe(2);
  }, 30_000);

  it('keeps the sx baseline empty', () => {
    const baseline: unknown = JSON.parse(
      readFileSync(
        join(fixtureAppRoot, 'eslint-plugin-together', 'sx-layout-baseline.json'),
        'utf8',
      ),
    );
    expect(baseline).toEqual({});
  });
});
