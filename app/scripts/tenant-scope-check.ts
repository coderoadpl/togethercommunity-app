import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export interface TenantRepositoryMethod {
  file: string;
  line: number;
  method: string;
  repository: string;
  subject: string;
}

export interface TenantScopeAudit {
  excludedPorts: string[];
  exceptions: TenantRepositoryMethod[];
  methods: TenantRepositoryMethod[];
  scoped: TenantRepositoryMethod[];
  staleExcludedPorts: string[];
  staleExceptions: string[];
  violations: TenantRepositoryMethod[];
}

export interface TenantScopeSource {
  file: string;
  source: string;
}

export const TENANT_SCOPE_EXCEPTIONS: Readonly<Record<string, string>> = {
  'AutoInvoiceJobRepository.claimDue': 'A platform worker leases the next due job across all tenants.',
  'AutomationIdempotencyRepository.sweepExpired': 'A platform worker removes expired keys across all tenants.',
  'ConsentEvidenceRetentionRepository.listExpiredTenantIds': 'A platform retention worker discovers tenants with expired consent evidence.',
  'EmailOutboxRepository.claimBatch': 'A platform dispatcher leases deliverable messages across all tenants.',
  'EmailOutboxRepository.enqueue': 'The atomic input carries a nullable tenantId because platform email has no tenant.',
  'EmailOutboxRepository.markFailed': 'The dispatcher updates only the message held by its run lease.',
  'EmailOutboxRepository.markSent': 'The dispatcher updates only the message held by its run lease.',
  'EnrollmentTransactionPort.run': 'The transaction wrapper supplies atomic database execution without reading tenant data itself.',
  'PaymentTransactionPort.run': 'The transaction wrapper supplies atomic database execution without reading tenant data itself.',
  'DevEmailReader.findByRecipient': 'The development email sink is platform scratch data without tenant ownership.',
  'DevMagicLinkReader.findByEmail': 'The development magic-link sink is platform scratch data without tenant ownership.',
  'DevSinkPurge.purge': 'Development startup clears all platform scratch sinks.',
  'HealthPort.pingDatabase': 'The platform health probe checks connectivity without reading tenant data.',
  'KsefSubmissionJobRepository.claimDue': 'A platform worker leases the next due job across all tenants.',
  'MarketingJobRepository.listRetentionTenantIds': 'A platform worker discovers tenants due for retention work.',
  'MarketingJobRepository.listRunnableCampaigns': 'A platform worker discovers runnable campaigns with their tenant IDs.',
  'MarketingJobRepository.listSesIdentityRefreshTenantIds': 'A platform worker discovers tenants due for identity refresh.',
  'MarketingJobRepository.listSesTenantIds': 'A platform worker discovers tenants due for SES polling.',
  'SchedulerRunRepository.failStale': 'A platform worker closes stale runs across all tenants.',
  'SchedulerRunRepository.finalize': 'A scheduler run is a platform aggregate containing per-tenant results.',
  'SchedulerRunRepository.getWithTenants': 'Operator diagnostics read a platform run and all of its tenant results.',
  'SchedulerRunRepository.listPage': 'Operator diagnostics list platform scheduler runs.',
  'SchedulerRunRepository.start': 'A scheduler run is a platform aggregate spanning tenants.',
  'TenantDomainRepository.findByDomain': 'Tenant resolution must look up a tenant before a tenant ID exists.',
  'TenantDomainRepository.listVerifiedDomains': 'Domain routing builds a platform-wide verified-domain index.',
  'TenantRepository.createTenantWithOwnerGrant': 'Tenant provisioning creates the tenant boundary and its first grant atomically.',
  'TenantRepository.findBySlug': 'Tenant resolution must look up a tenant before a tenant ID exists.',
  'TenantRepository.findSole': 'Single-tenant resolution must identify the sole tenant before a tenant ID exists.',
  'TenantRepository.hasAny': 'Bootstrap admission checks whether any tenant exists before creating the tenant boundary.',
  'TenantSesSettingsRepository.findByWebhookToken': 'The signed provider webhook token resolves the owning tenant.',
  'TenantAccessReader.findStaffGrant': 'Tenant resolution may start from a slug before a tenant ID exists.',
  'TenantAccessReader.listTenantsForStaff': 'Sign-in discovers the tenants available to a platform user.',
};

export const NON_DATA_PORTS: Readonly<Record<string, string>> = {
  ApiClientOptions: 'HTTP client callback configuration with no persistence access.',
  ApiKeyCrypto: 'Cryptographic primitive with no persistence access.',
  AppDeps: 'Server composition callbacks with no direct persistence access.',
  AuthE2eClient: 'Authentication test-driver boundary.',
  AuthSettings: 'Authentication-provider callback configuration.',
  AuthClientPort: 'Client-side authentication transport boundary.',
  AuthPort: 'Authentication-provider boundary whose records are platform identities.',
  BunnyTokenSigner: 'Media token-signing boundary with no persistence access.',
  CliAuthAdapter: 'CLI authentication transport boundary.',
  Clock: 'Time source with no persistence access.',
  ContentHash: 'Hashing primitive with no persistence access.',
  DevMarketingScheduler: 'Development scheduler control boundary.',
  DiscussionLinkPort: 'URL construction boundary with no persistence access.',
  EmailPort: 'Email delivery boundary with no persistence access.',
  Fa3Validator: 'Invoice validation boundary with no persistence access.',
  FulfillEnrollmentDeps: 'Use-case email dispatch callback.',
  IdGenerator: 'Identifier source with no persistence access.',
  ImportAuthGateway: 'Authentication import boundary.',
  ImportRunOptions: 'Import clock callback configuration.',
  InvoicingPort: 'External invoicing-provider boundary.',
  KsefAppDeps: 'Server composition dispatch callback.',
  KsefClientPort: 'External KSeF API boundary.',
  KsefClientOptions: 'KSeF client clock and wait callback configuration.',
  KsefDispatcher: 'KSeF job dispatch boundary.',
  KsefDispatchLogger: 'KSeF operational logging boundary.',
  KsefInvoicePdf: 'Invoice rendering boundary with no persistence access.',
  MarketingAppDeps: 'Server composition dispatch callbacks.',
  NotificationChannelPort: 'Notification delivery boundary with no persistence access.',
  NotificationStreamSource: 'Browser event-stream boundary.',
  NotificationsStreamHandle: 'Browser event-stream lifecycle handle.',
  NotificationsStreamOptions: 'Browser event-stream callback configuration.',
  PaymentProvider: 'External payment-provider boundary.',
  PublicMarketingMessages: 'Localized message formatter callbacks.',
  RawSesClient: 'External SES API boundary.',
  RealtimeBusPort: 'Ephemeral event-delivery boundary with no persistence access.',
  ResendHttpClient: 'External Resend API transport boundary.',
  ResendHttpResponse: 'External Resend API response boundary.',
  SecretCrypto: 'Cryptographic primitive with no persistence access.',
  SesSender: 'External SES delivery boundary.',
  SesMarketingQuotaReader: 'External SES quota boundary.',
  SesMarketingSender: 'External SES delivery boundary.',
  SesOnboardingControlPlane: 'External SES and SNS control-plane boundary.',
  SmtpTransport: 'External SMTP delivery boundary.',
  SnsSubscriptionOperations: 'External SNS subscription boundary.',
  SnsVerifier: 'External SNS verification boundary.',
  StorageProvider: 'Object-storage URL-signing boundary with no persistence access.',
  StorageProviderOptions: 'Object-storage adapter callbacks and probe configuration with no persistence access.',
  StorageResponse: 'External object-storage response boundary.',
  StripePaymentProviderConfig: 'External Stripe client configuration and factory callback.',
  SupportMessageDeps: 'Use-case email dispatch callback.',
  TestDatabase: 'Test-only ephemeral database handle with no tenant data.',
  TokenGenerator: 'Token source with no persistence access.',
  TransactionalEmailSender: 'Transactional email delivery boundary.',
  VideoLibraryPort: 'External video-library boundary.',
};

const appRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const defaultRoots = ['core', 'adapters', 'apps'].map((path) => join(appRoot, path));

const propertyName = (name: ts.PropertyName | ts.BindingName | undefined): string | null => {
  if (name === undefined) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
};

const callableParameters = (member: ts.TypeElement): readonly ts.ParameterDeclaration[] | null => {
  if (ts.isMethodSignature(member)) return member.parameters;
  if (ts.isPropertySignature(member) && member.type !== undefined && ts.isFunctionTypeNode(member.type)) {
    return member.type.parameters;
  }
  return null;
};

const methodName = (member: ts.TypeElement, sourceFile: ts.SourceFile): string => {
  if (ts.isMethodSignature(member) || ts.isPropertySignature(member)) {
    return propertyName(member.name) ?? member.name.getText(sourceFile);
  }
  return member.getText(sourceFile);
};

const hasRequiredTenantIdProperty = (
  type: ts.TypeNode | undefined,
  declarations: ReadonlyMap<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>,
  seen = new Set<string>(),
): boolean => {
  if (type === undefined) return false;
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const name = type.typeName.text;
    if (seen.has(name)) return false;
    const declaration = declarations.get(name);
    if (declaration === undefined) return false;
    const nextSeen = new Set(seen).add(name);
    if (ts.isInterfaceDeclaration(declaration)) {
      return declaration.members.some(
        (member) =>
          ts.isPropertySignature(member)
          && propertyName(member.name) === 'tenantId'
          && member.questionToken === undefined
          && member.type?.kind === ts.SyntaxKind.StringKeyword,
      ) || declaration.heritageClauses?.some(
        (clause) => clause.types.some(
          (entry) => hasRequiredTenantIdProperty(entry, declarations, nextSeen),
        ),
      ) === true;
    }
    return hasRequiredTenantIdProperty(declaration.type, declarations, nextSeen);
  }
  if (ts.isIntersectionTypeNode(type)) {
    return type.types.some((entry) => hasRequiredTenantIdProperty(entry, declarations, seen));
  }
  return ts.isTypeLiteralNode(type)
    && type.members.some(
      (member) =>
        ts.isPropertySignature(member)
        && propertyName(member.name) === 'tenantId'
        && member.questionToken === undefined
        && member.type?.kind === ts.SyntaxKind.StringKeyword,
    );
};

const tenantScoped = (
  parameters: readonly ts.ParameterDeclaration[],
  declarations: ReadonlyMap<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>,
): boolean => {
  const first = parameters[0];
  if (
    first === undefined
    || first.questionToken !== undefined
    || first.initializer !== undefined
    || first.dotDotDotToken !== undefined
  ) {
    return false;
  }
  return (
    propertyName(first.name) === 'tenantId'
      ? first.type?.kind === ts.SyntaxKind.StringKeyword
      : hasRequiredTenantIdProperty(first.type, declarations)
  );
};

const typeLiteralMembers = (type: ts.TypeNode): readonly ts.TypeElement[] => {
  if (ts.isTypeLiteralNode(type)) return type.members;
  if (ts.isIntersectionTypeNode(type)) return type.types.flatMap(typeLiteralMembers);
  return [];
};

const declarationMembers = (
  statement: ts.Statement,
): { members: readonly ts.TypeElement[]; name: string } | null => {
  if (ts.isInterfaceDeclaration(statement)) {
    return { members: statement.members, name: statement.name.text };
  }
  if (ts.isTypeAliasDeclaration(statement)) {
    const members = typeLiteralMembers(statement.type);
    if (members.length > 0) return { members, name: statement.name.text };
  }
  return null;
};

export const auditTenantRepositoryScopes = (
  sources: readonly TenantScopeSource[],
  exceptions: Readonly<Record<string, string>> = TENANT_SCOPE_EXCEPTIONS,
  excludedPorts: Readonly<Record<string, string>> = NON_DATA_PORTS,
  reportAllStale = true,
): TenantScopeAudit => {
  const methods: TenantRepositoryMethod[] = [];
  const scoped: TenantRepositoryMethod[] = [];
  const approved: TenantRepositoryMethod[] = [];
  const violations: TenantRepositoryMethod[] = [];
  const seenExceptions = new Set<string>();
  const seenExcludedPorts = new Set<string>();
  const seenDeclarations = new Set<string>();

  for (const input of sources) {
    const sourceFile = ts.createSourceFile(
      input.file,
      input.source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const declarations = new Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>();
    for (const statement of sourceFile.statements) {
      if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
        declarations.set(statement.name.text, statement);
      }
    }
    for (const statement of sourceFile.statements) {
      const declaration = declarationMembers(statement);
      if (declaration === null) continue;
      seenDeclarations.add(declaration.name);
      const excluded = declaration.name in excludedPorts;
      if (excluded) seenExcludedPorts.add(declaration.name);
      for (const member of declaration.members) {
        const parameters = callableParameters(member);
        if (parameters === null) continue;
        if (excluded) continue;
        const method = methodName(member, sourceFile);
        const subject = `${declaration.name}.${method}`;
        const location = sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile));
        const found = {
          file: input.file,
          line: location.line + 1,
          method,
          repository: declaration.name,
          subject,
        };
        methods.push(found);
        if (tenantScoped(parameters, declarations)) {
          scoped.push(found);
        } else if (subject in exceptions) {
          approved.push(found);
          seenExceptions.add(subject);
        } else {
          violations.push(found);
        }
      }
    }
  }

  return {
    excludedPorts: [...seenExcludedPorts].sort(),
    exceptions: approved,
    methods,
    scoped,
    staleExcludedPorts: Object.keys(excludedPorts).filter(
      (name) => !seenExcludedPorts.has(name) && (reportAllStale || seenDeclarations.has(name)),
    ),
    staleExceptions: Object.keys(exceptions).filter((subject) => {
      const declaration = subject.split('.')[0] ?? '';
      return !seenExceptions.has(subject) && (reportAllStale || seenDeclarations.has(declaration));
    }),
    violations,
  };
};

const sourceFiles = (path: string): string[] => {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) {
      return [];
    }
    return [child];
  });
};

export const collectTenantScopeSources = (
  paths: readonly string[] = defaultRoots,
): TenantScopeSource[] =>
  paths.flatMap((path) =>
    sourceFiles(path).map((file) => ({
      file: relative(appRoot, file),
      source: readFileSync(file, 'utf8'),
    })),
  );

const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  const requestedPaths = process.argv.slice(2).map((path) => resolve(appRoot, path));
  const audit = auditTenantRepositoryScopes(
    collectTenantScopeSources(requestedPaths.length > 0 ? requestedPaths : undefined),
    TENANT_SCOPE_EXCEPTIONS,
    NON_DATA_PORTS,
    requestedPaths.length === 0,
  );
  if (
    audit.violations.length > 0
    || audit.staleExceptions.length > 0
    || audit.staleExcludedPorts.length > 0
  ) {
    process.stderr.write('tenant-scope-check: repository scope contract failed\n');
    for (const violation of audit.violations) {
      process.stderr.write(
        `  ${violation.file}:${String(violation.line)} ${violation.subject} must take tenantId as its first parameter\n`,
      );
    }
    for (const exception of audit.staleExceptions) {
      process.stderr.write(`  stale exception: ${exception}\n`);
    }
    for (const port of audit.staleExcludedPorts) {
      process.stderr.write(`  stale non-data port: ${port}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(
    `tenant-scope-check: OK — ${String(audit.methods.length)} method(s), ${String(audit.exceptions.length)} justified platform exception(s), ${String(audit.excludedPorts.length)} non-data port(s)\n`,
  );
}
