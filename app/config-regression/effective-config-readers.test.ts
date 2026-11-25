import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const appRoot = join(import.meta.dirname, '..');
const runtimeRoots = ['api', 'adapters', 'apps/server', 'core/server'];

interface ReaderRule {
  methods: readonly string[];
  receiver: RegExp;
  fileReads?: RegExp;
}

const READER_RULES: Readonly<Record<string, ReaderRule>> = {
  'workspace secret rows': { methods: ['findByKey', 'listByTenant'], receiver: /secrets$/i },
  'workspace settings with invoicing fields': {
    methods: ['findSettings'],
    receiver: /^tenants$/,
    fileReads: /\b(?:invoicingProvider|invoiceSellerName|invoiceSellerAddress|ksefSubmissionMode)\b/,
  },
  'workspace ShipX settings': { methods: ['find'], receiver: /^shipxSettings$/ },
  'workspace SES settings with footer fields': {
    methods: ['findByTenant'],
    receiver: /^(?:sesSettings|settings)$/,
    fileReads: /\b(?:footerLegalName|footerAddress)\b/,
  },
};

const PAYMENT_SOURCE = 'the workspace rule of a payment reader, applied only while the payment source reader answers the workspace';
const O10 = 'O10 moves the invoicing readers to the effective seam';
const O13 = 'O13 moves the ShipX readers to the effective seam';
const O14 = 'O14 moves the e-mail transport readers to the effective seam';
const O15 = 'O15 moves the telemetry readers to the effective seam';
const WORKSPACE_ONLY = 'reads only per-workspace values on purpose';

const ALLOWED_DIRECT_READERS: Readonly<Record<string, { calls: number; reason: string }>> = {
  'adapters/crypto/tenant-secret-resolver.ts secrets.findByKey': {
    calls: 3,
    reason: 'the workspace resolver that createEffectiveTenantSecretResolver wraps',
  },
  'core/server/telemetry/drain.ts secrets.findByKey': { calls: 1, reason: O15 },
  'core/server/usecases/telemetry-store.ts secrets.findByKey': { calls: 1, reason: O15 },
  'core/server/usecases/checkout.ts tenantSecrets.findByKey': { calls: 2, reason: PAYMENT_SOURCE },
  'core/server/usecases/configure-stripe.ts tenantSecrets.findByKey': {
    calls: 2,
    reason: 'configures the workspace\'s own payment rows; reporting that they are not in force while inherited comes with the switch',
  },
  'core/server/usecases/onboarding.ts tenantSecrets.findByKey': { calls: 1, reason: PAYMENT_SOURCE },
  'core/server/usecases/operator-tenant-readiness.ts tenantSecrets.listByTenant': { calls: 1, reason: `${PAYMENT_SOURCE}; storage rows never inherit` },
  'core/server/usecases/tenant-secrets.ts tenantSecrets.listByTenant': {
    calls: 2,
    reason: `${PAYMENT_SOURCE}; the SES identity check on save is moved by O14`,
  },
  'core/server/usecases/tenant-setup-readiness.ts tenantSecrets.listByTenant': {
    calls: 1,
    reason: `${PAYMENT_SOURCE}; O10 and O14 make the rest of the setup readiness source-aware`,
  },
  'core/server/usecases/invoices.ts tenantSecrets.findByKey': { calls: 2, reason: O10 },
  'core/server/usecases/shipx.ts tenantSecrets.findByKey': { calls: 1, reason: O13 },
  'core/server/usecases/shipx.ts tenantSecrets.listByTenant': { calls: 1, reason: O13 },
  'core/server/usecases/marketing-management.ts secrets.listByTenant': { calls: 2, reason: O14 },
  'core/server/usecases/deep-health.ts tenantSecrets.listByTenant': {
    calls: 1,
    reason: `${WORKSPACE_ONLY}: the storage health probe needs the s3.* rows, which never inherit`,
  },
  'core/server/usecases/invoices.ts tenants.findSettings': { calls: 4, reason: O10 },
  'core/server/usecases/tenant-setup-readiness.ts tenants.findSettings': { calls: 1, reason: O10 },
  'core/server/usecases/marketing-email.ts sesSettings.findByTenant': { calls: 5, reason: O14 },
  'core/server/usecases/marketing-management.ts settings.findByTenant': { calls: 2, reason: O14 },
  'core/server/usecases/marketing-ses-onboarding.ts settings.findByTenant': { calls: 3, reason: O14 },
};

const runtimeFiles = (directory: string): string[] => readdirSync(join(appRoot, directory), { withFileTypes: true })
  .flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'testing' || entry.name === 'node_modules' ? [] : runtimeFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.(?:test|d)\.tsx?$/.test(entry.name) ? [path] : [];
  });

const receiverName = (expression: ts.Expression): string => {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isNonNullExpression(expression) || ts.isParenthesizedExpression(expression)) return receiverName(expression.expression);
  return '';
};

const collectDirectReaders = (files: ReadonlyMap<string, string>): Record<string, number> => {
  const found: Record<string, number> = {};
  for (const [file, source] of files) {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const receiver = receiverName(node.expression.expression);
        const matches = Object.values(READER_RULES).some((rule) =>
          rule.methods.includes(method) && rule.receiver.test(receiver) && (rule.fileReads?.test(source) ?? true));
        if (matches) {
          const subject = `${file} ${receiver}.${method}`;
          found[subject] = (found[subject] ?? 0) + 1;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return found;
};

const readRuntimeSources = (): Map<string, string> => new Map(runtimeRoots.flatMap(runtimeFiles)
  .map((path) => [relative(appRoot, join(appRoot, path)).replaceAll('\\', '/'), readFileSync(join(appRoot, path), 'utf8')]));

describe('direct readers of inheritable configuration', () => {
  it('lists every runtime reader that bypasses the effective configuration seam', () => {
    const allowed = Object.fromEntries(Object.entries(ALLOWED_DIRECT_READERS).map(([subject, { calls }]) => [subject, calls]));
    expect(collectDirectReaders(readRuntimeSources())).toEqual(allowed);
  });

  it('reports a new direct secret read, settings read, ShipX read and SES footer read', () => {
    const files = new Map([
      ['core/server/usecases/new-reader.ts', [
        'const a = await deps.tenantSecrets.findByKey(tenantId, "smtp.host");',
        'const b = await deps.tenants?.findSettings(tenantId);',
        'const seller = b?.invoiceSellerName;',
        'const c = await deps.shipxSettings.find(tenantId);',
        'const d = await deps.tenantDomains.listByTenant(tenantId);',
      ].join('\n')],
      ['core/server/usecases/footer-reader.ts', 'const f = await deps.settings.findByTenant(tenantId);\nreturn f?.footerAddress;'],
      ['core/server/usecases/brand-reader.ts', 'const e = await deps.tenants.findSettings(tenantId);\nreturn e?.name;'],
    ]);
    expect(collectDirectReaders(files)).toEqual({
      'core/server/usecases/new-reader.ts tenantSecrets.findByKey': 1,
      'core/server/usecases/new-reader.ts tenants.findSettings': 1,
      'core/server/usecases/new-reader.ts shipxSettings.find': 1,
      'core/server/usecases/footer-reader.ts settings.findByTenant': 1,
    });
  });
});
