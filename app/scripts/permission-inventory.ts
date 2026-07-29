import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import {
  CAPABILITIES,
  PRINCIPALS,
  ROLE_CAPABILITIES,
} from '#core/contract/index.js';
import type { Capability, Principal } from '#core/domain/index.js';

import { publicRouteManifestEntry } from '../apps/server/src/public-route-manifest.js';
import { selfAuthenticatingRouteManifestEntry } from '../apps/server/src/self-authenticating-route-manifest.js';
import { collectRuntimeRoutes } from './generate-route-table.mjs';

export interface PermissionRow {
  subject: string;
  capability: Capability | null;
  before: readonly Principal[];
  after: readonly Principal[];
  derivable: boolean;
  evidence: string;
}

export interface SuspiciousPermission {
  subject: string;
  behavior: string;
}

export interface PermissionInventory {
  routes: PermissionRow[];
  useCases: PermissionRow[];
  sourceEvidence: AuthorizationEvidence[];
  suspicious: SuspiciousPermission[];
}

export interface AuthorizationEvidence {
  kind: 'staff-role' | 'api-key' | 'member-scope';
  location: string;
  expression: string;
}

const appRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const useCasesRoot = join(appRoot, 'core', 'server', 'usecases');
const allHumans = ['owner', 'admin', 'member', 'authenticated'] as const;
const tenantActors = ['owner', 'admin', 'member'] as const;
const staff = ['owner', 'admin'] as const;
const owner = ['owner'] as const;
const member = ['member'] as const;
const publicPrincipal = ['public'] as const;
const apiKey = ['api-key'] as const;
const operatorSecret = ['operator-secret'] as const;
const webhook = ['webhook'] as const;
const token = ['token'] as const;
const authenticated = ['authenticated'] as const;

const principalsForCapability = (capability: Capability): readonly Principal[] =>
  PRINCIPALS.filter((principal) => ROLE_CAPABILITIES[principal].includes(capability));

const effectiveAfter = (
  before: readonly Principal[],
  capability: Capability,
): readonly Principal[] => {
  const holders = principalsForCapability(capability);
  return before.filter((principal) => holders.includes(principal));
};

const capabilityForRoute = (method: string, path: string): Capability | null => {
  if (path === '*' || path === '/*') return 'offer:read';
  if (path.startsWith('/api/health')) return 'health:read';
  if (publicRouteManifestEntry({ method, path })?.why.toLowerCase().includes('authentication') === true) return 'auth:use';
  if (path === '/api/public/offer') return 'offer:read';
  if (path === '/api/public/payment-config' || path === '/api/public/checkout/coupon') return 'checkout:read';
  if (path === '/api/public/checkout/session') return 'checkout:start';
  if (path === '/api/public/auth-config') return 'auth:use';
  if (path.startsWith('/api/webhooks/')) return 'webhook:process';
  if (path.startsWith('/u/')) return method === 'GET' ? 'marketing:consent:read' : 'marketing:consent:write';
  if (path.startsWith('/marketing/confirm/')) return method === 'GET' ? 'marketing:consent:read' : 'marketing:consent:write';
  if (path.startsWith('/legal/')) return 'legal:read';
  if (path === '/api/internal/dispatch-email' || path === '/api/internal/dispatch-ksef') return 'scheduler:dispatch';
  if (path.startsWith('/api/internal/scheduler-runs')) return 'scheduler:read';
  if (path === '/api/public/terms-consent') return 'terms:accept';
  if (path === '/api/tenants' && method === 'POST') return 'tenant:create';
  if (path.startsWith('/api/dev/')) return method === 'GET' ? 'development:inspect' : 'development:mutate';
  if (path === '/api/m2m/enroll') return 'enrollment:create';
  if (path.startsWith('/api/m2m/marketing/messages')) return method === 'GET' ? 'marketing:message:read' : 'marketing:message:send';
  if (path === '/api/m2m/marketing/eligibility') return 'marketing:consent:read';
  if (path === '/api/m2m/marketing/consents') return 'marketing:consent:write';
  if (path.startsWith('/api/m2m/marketing/suppressions')) return method === 'GET' ? 'marketing:suppression:read' : 'marketing:suppression:write';
  if (path === '/api/m2m/marketing/consent-definitions') return 'marketing:consent:read';
  if (path === '/api/m2m/marketing/templates') return 'marketing:layout:read';
  if (path === '/api/internal/marketing/tick') return 'scheduler:dispatch';
  if (path.startsWith('/api/marketing/consent-definitions')) return method === 'GET' ? 'marketing:consent-definition:read' : 'marketing:consent-definition:write';
  if (path.startsWith('/api/marketing/scheduler-runs')) return 'scheduler:read';
  if (path.startsWith('/api/marketing/campaigns')) {
    if (method === 'GET') return 'marketing:campaign:read';
    return path.endsWith('/schedule') || path.endsWith('/action') || path.endsWith('/test')
      ? 'marketing:campaign:send'
      : 'marketing:campaign:write';
  }
  if (path === '/api/marketing/audience-preview') return 'marketing:campaign:read';
  if (path.startsWith('/api/marketing/documents')) return method === 'GET' ? 'marketing:document:read' : 'marketing:document:write';
  if (path.startsWith('/api/marketing/layouts')) return method === 'GET' ? 'marketing:layout:read' : 'marketing:layout:write';
  if (path.startsWith('/api/marketing/ses-') || path === '/api/marketing/smtp/test') return method === 'GET' ? 'marketing:ses:read' : 'marketing:ses:write';
  if (path === '/api/marketing/reputation') return 'marketing:reputation:read';
  if (path === '/api/marketing/suppressions') return method === 'GET' ? 'marketing:suppression:read' : 'marketing:suppression:write';
  if (path.startsWith('/api/marketing/sends') || /^\/api\/members\/:id\/emails$/.test(path)) return 'marketing:delivery:read';
  if (path === '/api/me' || path === '/api/tenants') return 'tenant:list-own';
  if (path === '/api/me/billing-orders') return 'member:billing:read';
  if (path === '/api/me/data-export') return 'member:data-export:self-read';
  if (path === '/api/me/erasure-request') return 'member:erasure:self-request';
  if (path === '/api/my/products') return 'member:product:read';
  if (path === '/api/members/ban') return 'member:ban';
  if (path === '/api/members') return 'member:read';
  if (path === '/api/members/erasure-requests') return 'member:erasure:read';
  if (/^\/api\/members\/erasure-requests\/:requestId\/reject$/.test(path)) return 'member:remove';
  if (path === '/api/members/export') return 'member:export';
  if (path.endsWith('/grants') && path.startsWith('/api/members/')) return 'member:grant:read';
  if (path.endsWith('/learning-summary')) return 'member:learning:read';
  if (path.endsWith('/progress-reset')) return 'member:progress:manage';
  if (path.startsWith('/api/members/') && method === 'DELETE') return 'member:remove';
  if (path === '/api/grants' || path.startsWith('/api/grants/')) return 'member:grant:write';
  if (path === '/api/api-keys') return method === 'GET' ? 'api-key:read' : 'api-key:write';
  if (path.startsWith('/api/api-keys/')) return 'api-key:write';
  if (path === '/api/tenant-secrets') return method === 'GET' ? 'tenant:secret:read' : 'tenant:secret:write';
  if (path.startsWith('/api/tenant-secrets/')) return 'tenant:secret:write';
  if (path === '/api/tenant/settings') return method === 'GET' ? 'tenant:settings:read' : 'tenant:settings:write';
  if (path === '/api/support/message') return 'support:request';
  if (path.startsWith('/api/onboarding')) return method === 'GET' ? 'tenant:onboarding:read' : 'tenant:onboarding:write';
  if (path === '/api/integrations/bunny/videos') return 'course:read';
  if (path.startsWith('/api/integrations/')) return 'integration:test';
  if (path === '/api/products') return method === 'GET' ? 'product:read' : 'product:write';
  if (path.endsWith('/publish')) return 'product:publish';
  if (path.endsWith('/access-items')) return 'product:access:write';
  if (path.endsWith('/access-issues')) return 'product:access:read';
  if (path.includes('/prices')) return method === 'GET' ? 'product:price:read' : 'product:price:write';
  if (path === '/api/orders/reconciliation') return 'order:reconcile';
  if (path === '/api/orders' || /^\/api\/orders\/:[^/]+$/.test(path)) return 'order:read';
  if (path === '/api/orders/export') return 'order:export';
  if (path === '/api/sales/summary') return 'sales:read';
  if (path.includes('/invoice') || path.includes('/invoices/')) {
    if (path.startsWith('/api/me/')) return 'invoice:member-read';
    return method === 'GET' ? 'invoice:read' : 'invoice:write';
  }
  if (path.startsWith('/api/coupons')) {
    if (method === 'GET' && (path === '/api/coupons' || path === '/api/coupons/export' || path.includes('/stats'))) return 'coupon:report';
    return method === 'GET' ? 'coupon:read' : 'coupon:write';
  }
  if (path === '/api/courses' || path.startsWith('/api/courses/')) return method === 'GET' ? 'course:read' : 'course:write';
  if (path.startsWith('/api/modules') || path.startsWith('/api/lessons')) return method === 'GET' ? 'course:read' : 'course:write';
  if (path.startsWith('/api/student/')) {
    if (path.includes('/progress') || path.includes('/last-viewed') || path.includes('/complete')) {
      return method === 'GET' ? 'member:progress:read' : 'member:progress:self-write';
    }
    return 'lesson:play';
  }
  if (path === '/api/posts/pin') return 'community:pin';
  if (path === '/api/posts/report') return 'community:report';
  if (path === '/api/reports') return 'community:report:read';
  if (path === '/api/reports/resolve') return 'community:moderate';
  if (path.startsWith('/api/posts') || path.startsWith('/api/discussion') || path.startsWith('/api/threads')) {
    return method === 'GET' ? 'community:read' : 'community:write';
  }
  if (path.includes('/follow') || path.includes('/react')) return 'space:interact';
  if (path === '/api/spaces/staff') return 'space:write';
  if (path.startsWith('/api/spaces')) return method === 'GET' ? 'space:read' : 'space:write';
  if (path.startsWith('/api/notifications')) return method === 'GET' ? 'notification:read' : 'notification:write';
  if (path === '/api/bunny/videos') return 'course:read';
  if (path === '/api/bunny/test') return 'integration:test';
  return null;
};

const beforeForRoute = (
  method: string,
  path: string,
): readonly Principal[] => {
  const route = { method, path };
  const publicEntry = publicRouteManifestEntry(route);
  if (publicEntry !== undefined) {
    if (path.startsWith('/api/webhooks/')) return webhook;
    if (path.startsWith('/u/') || path.startsWith('/marketing/confirm/')) return token;
    return publicPrincipal;
  }
  const selfAuthenticatingEntry = selfAuthenticatingRouteManifestEntry(route);
  if (selfAuthenticatingEntry !== undefined) {
    if (selfAuthenticatingEntry.mechanism === 'Tenant API key') return apiKey;
    if (selfAuthenticatingEntry.mechanism.includes('secret')) return operatorSecret;
    if (selfAuthenticatingEntry.mechanism.includes('session')) return authenticated;
    return publicPrincipal;
  }
  if (path === '/api/me' || path === '/api/tenants') return allHumans;
  if (path === '/api/me/billing-orders' || path === '/api/me/data-export' || path === '/api/me/erasure-request' || path === '/api/my/products' || path.startsWith('/api/me/invoices/')) return member;
  if (path.startsWith('/api/student/')) {
    return capabilityForRoute(method, path) === 'lesson:play' ? tenantActors : member;
  }
  if (path === '/api/tenant/settings' && method === 'GET') return tenantActors;
  if (path === '/api/support/message') return tenantActors;
  if (path === '/api/posts/pin') return staff;
  if (path.startsWith('/api/posts') || path.startsWith('/api/discussion') || path.startsWith('/api/threads') || path.startsWith('/api/notifications')) return tenantActors;
  if (path.startsWith('/api/spaces') && path !== '/api/spaces/staff' && method === 'GET') return tenantActors;
  if (path.includes('/follow') || path.includes('/react')) return tenantActors;
  if (
    (path === '/api/tenant/settings' && method !== 'GET')
    || (path.startsWith('/api/tenant-secrets') && method !== 'GET')
    || (path.startsWith('/api/api-keys') && method !== 'GET')
    || (path.startsWith('/api/integrations/') && path !== '/api/integrations/bunny/videos')
    || path === '/api/bunny/test'
  ) return owner;
  return staff;
};

const reachableForRoute = (
  method: string,
  path: string,
): readonly Principal[] => {
  const route = { method, path };
  const publicEntry = publicRouteManifestEntry(route);
  if (publicEntry !== undefined) return beforeForRoute(method, path);
  const selfAuthenticatingEntry = selfAuthenticatingRouteManifestEntry(route);
  if (selfAuthenticatingEntry !== undefined) return beforeForRoute(method, path);
  if (path === '/api/me' || path === '/api/tenants') return allHumans;
  return tenantActors;
};

const routeRows = (): PermissionRow[] =>
  collectRuntimeRoutes()
    .map((route) => {
      const capability = capabilityForRoute(route.method, route.path);
      const before = beforeForRoute(route.method, route.path);
      const reachable = reachableForRoute(route.method, route.path);
      return {
        subject: `${route.method} ${route.path}`,
        capability,
        before,
        after: capability === null ? [] : effectiveAfter(reachable, capability),
        derivable: capability !== null,
        evidence: publicRouteManifestEntry(route) !== undefined
          ? 'public route manifest'
          : selfAuthenticatingRouteManifestEntry(route)?.mechanism ?? 'identity middleware + use-case guard',
      };
    });

export interface CollectedUseCase {
  name: string;
  file: string;
  capability: Capability;
}

const AUTHORIZATION_UTILITIES = new Set([
  'community-access.ts#memberScope',
  'community-access.ts#requireActor',
  'community-access.ts#requireMemberOrStaff',
  'community-access.ts#requireUnbannedMember',
  'community-access.ts#requireTenant',
]);

const authorizationCallNames = new Set([
  'authorize',
  'authorizeRequiredTenant',
  'authorizeTenant',
  'requireActor',
  'requireMember',
  'requireMemberOrStaff',
  'requireUnbannedMember',
  'requireStaff',
  'requireStaffTenant',
  'requireTenant',
  'staffTenantIdFrom',
  'tenantIdFrom',
]);

const capabilityFromBody = (
  body: ts.ConciseBody,
  subject: string,
): Capability => {
  const capabilities: Capability[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && authorizationCallNames.has(node.expression.text)) {
      const argument = node.arguments[1];
      if (argument !== undefined && ts.isStringLiteral(argument)) {
        const capability = CAPABILITIES.find((candidate) => candidate === argument.text);
        if (capability === undefined) {
          throw new Error(`${subject} declares unknown capability ${argument.text}`);
        }
        capabilities.push(capability);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  if (capabilities.length !== 1) {
    throw new Error(
      `${subject} must declare exactly one authorization capability; found ${capabilities.join(', ') || 'none'}`,
    );
  }
  const capability = capabilities[0];
  if (capability === undefined) throw new Error(`${subject} has no authorization capability`);
  return capability;
};

const hasExportModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node)
  && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;

const isCtxShapedParameter = (
  parameter: ts.ParameterDeclaration | undefined,
  sourceFile: ts.SourceFile,
): boolean =>
  parameter !== undefined
  && (
    (ts.isIdentifier(parameter.name) && parameter.name.text === 'ctx')
    || /\bidentity\s*[?:]/u.test(parameter.type?.getText(sourceFile) ?? '')
  );

const isBareCtxType = (
  parameter: ts.ParameterDeclaration | undefined,
): boolean =>
  parameter?.type !== undefined
  && ts.isTypeReferenceNode(parameter.type)
  && ts.isIdentifier(parameter.type.typeName)
  && parameter.type.typeName.text === 'Ctx'
  && parameter.type.typeArguments === undefined;

const isCtxTypedParameter = (
  parameter: ts.ParameterDeclaration | undefined,
  sourceFile: ts.SourceFile,
): boolean =>
  isBareCtxType(parameter)
  || /\bCtx\b/u.test(parameter?.type?.getText(sourceFile) ?? '');

export const collectUseCasesInSource = (
  file: string,
  source: string,
): CollectedUseCase[] => {
  const found: CollectedUseCase[] = [];
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  sourceFile.statements.forEach((statement) => {
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement) && statement.name !== undefined) {
      const subject = `${file}#${statement.name.text}`;
      if (AUTHORIZATION_UTILITIES.has(subject)) return;
      if (
        isCtxShapedParameter(statement.parameters[0], sourceFile)
        || isCtxTypedParameter(statement.parameters[0], sourceFile)
      ) {
        throw new Error(
          `${subject} must be an exported const arrow function; function declarations are not classified`,
        );
      }
      return;
    }
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) return;
    statement.declarationList.declarations.forEach((declaration) => {
      if (!ts.isIdentifier(declaration.name)) return;
      const initializer = declaration.initializer;
      if (initializer === undefined || (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer))) return;
      const subject = `${file}#${declaration.name.text}`;
      if (AUTHORIZATION_UTILITIES.has(subject)) return;
      const firstParameter = initializer.parameters[0];
      if (!isBareCtxType(firstParameter)) {
        if (
          isCtxShapedParameter(firstParameter, sourceFile)
          || isCtxTypedParameter(firstParameter, sourceFile)
        ) {
          throw new Error(
            `${subject} must type its first parameter as Ctx; inline ctx types are not classified`,
          );
        }
        return;
      }
      found.push({
        name: declaration.name.text,
        file,
        capability: capabilityFromBody(initializer.body, subject),
      });
    });
  });
  return found;
};

const collectCtxUseCases = (): CollectedUseCase[] =>
  readdirSync(useCasesRoot)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort()
    .flatMap((file) =>
      collectUseCasesInSource(file, readFileSync(join(useCasesRoot, file), 'utf8')));

const marketingTenantContextUseCases = new Set([
  'applyVerifiedSesEvent',
  'campaignTick',
  'claimIdempotencyKey',
  'completeIdempotentRequest',
  'confirmMarketingConsent',
  'getMarketingEligibility',
  'getUnsubscribePreferences',
  'purgeStalePendingConsents',
  'recordCheckoutMarketingConsents',
  'recordMarketingConsent',
  'runMarketingRetentionJobs',
  'saveMarketingConsentPreferences',
  'scheduleMarketingRetentionJobs',
  'sendMarketingMessages',
  'unsubscribeAllMarketing',
  'unsubscribeOneClick',
  'withdrawMarketingConsent',
]);

const beforeForUseCase = (
  file: string,
  name: string,
  capability: Capability,
): readonly Principal[] => {
  if (file === 'marketing-email.ts') {
    return marketingTenantContextUseCases.has(name) ? allHumans : staff;
  }
  if (file === 'marketing-ses-onboarding.ts' && name === 'refreshSesIdentity') {
    return allHumans;
  }
  if (file === 'email-reputation.ts' && name === 'runReputationAlerts') {
    return allHumans;
  }
  if (file === 'create-tenant.ts') return allHumans;
  if (file === 'member-billing-orders.ts' || file === 'member-data-export.ts' || file === 'member-erasure-requests.ts' || file === 'my-products.ts' || capability === 'invoice:member-read') return member;
  if (file === 'entitlements.ts') {
    return name === 'resolveMemberEntitlements' ? member : tenantActors;
  }
  if (file === 'lesson-media.ts') return tenantActors;
  if (file === 'progress.ts') return name === 'resetMemberCourseProgress' ? staff : member;
  if (file === 'tenant-settings.ts') return name === 'getTenantSettings' ? tenantActors : owner;
  if (file === 'api-keys.ts') return name === 'listTenantApiKeys' ? staff : owner;
  if (file === 'tenant-secrets.ts') return name === 'getTenantSecretsMasked' ? staff : owner;
  if (capability === 'integration:test') return owner;
  if (file === 'community-access.ts' || file === 'community.ts') return tenantActors;
  if (file === 'moderation.ts') return capability === 'community:report' ? tenantActors : staff;
  if (file === 'support.ts') return tenantActors;
  if (file === 'spaces.ts') {
    return name === 'listSpacesForStaff' || capability === 'space:write' || capability === 'community:pin'
      ? staff
      : tenantActors;
  }
  if (capability === 'tenant:list-own') return allHumans;
  return staff;
};

const useCaseRows = (): PermissionRow[] =>
  collectCtxUseCases().map(({ file, name, capability }) => {
    const before = beforeForUseCase(file, name, capability);
    const reachable = before === allHumans ? allHumans : tenantActors;
    return {
      subject: `${file}#${name}`,
      capability,
      before,
      after: effectiveAfter(reachable, capability),
      derivable: true,
      evidence: `${relative(appRoot, join(useCasesRoot, file))} authorization call`,
    };
  });

const collectSourceEvidence = (): AuthorizationEvidence[] => {
  const roots = [
    ...readdirSync(useCasesRoot)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => join(useCasesRoot, name)),
    ...readdirSync(join(appRoot, 'apps', 'server', 'src'))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => join(appRoot, 'apps', 'server', 'src', name)),
  ];
  const found: AuthorizationEvidence[] = [];
  for (const file of roots.sort()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      const expression = line.trim();
      const location = `${relative(appRoot, file)}:${String(index + 1)}`;
      if (expression.includes('staffRole') && /if\s*\(|\?|&&|\|\||includes\(/.test(expression)) {
        found.push({ kind: 'staff-role', location, expression });
      }
      if (/API_KEY_HEADER|authenticateApiKey|apiIdentity/.test(expression)) {
        found.push({ kind: 'api-key', location, expression });
      }
      if (
        /identity\.memberId|memberScope\(ctx\)/.test(expression)
        && /if\s*\(|\?|&&|\|\||return/.test(expression)
      ) {
        found.push({ kind: 'member-scope', location, expression });
      }
    });
  }
  return found;
};

const suspicious: SuspiciousPermission[] = [
  {
    subject: 'development-only routes',
    behavior: 'When the composition flag is enabled, these routes have no session or secret check; the flag alone is the current control (`apps/server/src/internal-app.ts`).',
  },
  {
    subject: 'GET /api/tenant/settings',
    behavior: 'A member can read tenant settings while updates remain owner-only (`core/server/usecases/tenant-settings.ts`).',
  },
  {
    subject: 'marketing synthetic identities',
    behavior: 'API-key, worker, checkout, unsubscribe, and webhook handlers synthesize Identity values; several marketing use-cases check only tenant context rather than the originating credential type (`apps/server/src/marketing-routes.ts`, `apps/server/src/internal-app.ts`, `core/server/usecases/marketing-email.ts`).',
  },
  {
    subject: 'tenant creation mode',
    behavior: 'The route supplies a tenantless authenticated identity, while direct use-case callers may also carry a staff or member grant; the deployment mode separately denies all creation when closed (`apps/server/src/internal-app.ts`, `core/server/usecases/create-tenant.ts`).',
  },
  {
    subject: 'staff with simultaneous membership',
    behavior: 'Identity resolution can carry both staffRole and memberId; staff checks take precedence in some use-cases while member-scoped use-cases accept the same identity through memberId (`core/server/usecases/resolve-identity.ts`, `core/server/authorize.ts`, `core/server/usecases/member-billing-orders.ts`).',
  },
  {
    subject: 'staff lesson access',
    behavior: 'Staff identities can use the student lesson and course-structure use-cases without a member row or product grant (`core/server/usecases/entitlements.ts`, `core/server/usecases/lesson-media.ts`).',
  },
];

export const collectPermissionInventory = (): PermissionInventory => ({
  routes: routeRows(),
  useCases: useCaseRows(),
  sourceEvidence: collectSourceEvidence(),
  suspicious,
});

const principals = (values: readonly Principal[]): string =>
  values.length === 0 ? 'none' : values.join(', ');

const renderRows = (rows: readonly PermissionRow[]): string[] =>
  rows.map((row) =>
    `| \`${row.subject}\` | ${row.capability ?? 'UNCLASSIFIED'} | ${principals(row.before)} | ${principals(row.after)} | ${row.derivable ? 'yes' : 'review'} | ${row.evidence} |`,
  );

export const renderPermissionTable = (inventory: PermissionInventory): string => {
  const changes = [...inventory.routes, ...inventory.useCases]
    .filter((row) => row.derivable)
    .filter((row) => row.before.join(',') !== row.after.join(','));
  if (changes.length > 0) {
    throw new Error(`Permission changes detected: ${changes.map((row) => row.subject).join(', ')}`);
  }
  const unclassified = [...inventory.routes, ...inventory.useCases].filter((row) => row.capability === null);
  if (unclassified.length > 0) {
    throw new Error(`Unclassified authorization surfaces: ${unclassified.map((row) => row.subject).join(', ')}`);
  }
  return [
    '# Permission table',
    '',
    'Generated by `pnpm run permissions:generate`. Do not edit by hand.',
    '',
    'BEFORE records the current edge middleware, inline checks, same-file guard helpers, API-key checks, token checks, webhook verification, and public manifests. AFTER records the effective principal set after the capability is applied at the same edge. The generator fails when a derivable row differs.',
    '',
    'Equivalence here compares principal **sets**, not capability identity. A capability renamed consistently across `CAPABILITIES`, `ROLE_CAPABILITIES` and its call sites produces the same BEFORE and AFTER principal sets, so this table reports "no changes" for it. The table proves that no principal gained or lost access; it does not prove that the capability vocabulary is unchanged. Reviewing a rename requires reading the diff of `core/domain/authorization.ts`.',
    '',
    'The `operator-secret` principal requires both `marketing:campaign:dispatch` and `marketing:message:send`. `campaignTickExecution` calls `sendMarketingMessages`, whose independent authorization check requires `marketing:message:send`; the original capability audit table listed only the outer campaign-dispatch requirement. This additional nested requirement is necessary for the marketing worker and does not change any effective principal set in the rows below.',
    '',
    'The `member` and `authenticated` matrix rows carry historically derived edge capabilities (`scheduler:dispatch`, `webhook:process`, `marketing:campaign:dispatch`, `marketing:message:send`, and `marketing:message:read`) that are not reachable through any session route (verified 2026-07-29). Narrowing these grants is recommended pending owner decision O-08.',
    '',
    'SPEC D5 deliberately delegates report resolution to `community:moderate`; a future owner review may retain that binding or replace it with a report-specific capability.',
    '',
    `Closed capability count: ${CAPABILITIES.length}. Route rows: ${inventory.routes.length}. Exported \`Ctx\` use-case rows: ${inventory.useCases.length}.`,
    '',
    '## Human-readable diff',
    '',
    'no changes',
    '',
    '## Routes',
    '',
    '| Route | Required capability | BEFORE | AFTER | Machine-equivalent | Evidence |',
    '|---|---|---|---|---|---|',
    ...renderRows(inventory.routes),
    '',
    '## Use-cases',
    '',
    '| Use-case | Required capability | BEFORE | AFTER | Machine-equivalent | Evidence |',
    '|---|---|---|---|---|---|',
    ...renderRows(inventory.useCases),
    '',
    '## Authorization source evidence',
    '',
    'This mechanical scan keeps every current staff-role predicate, API-key path, and member-scope predicate visible beside the route and use-case classification above.',
    '',
    '| Kind | Location | Expression |',
    '|---|---|---|',
    ...inventory.sourceEvidence.map((row) =>
      `| ${row.kind} | \`${row.location}\` | \`${row.expression.replaceAll('|', '\\|').replaceAll('`', '\\`')}\` |`,
    ),
    '',
    '## Suspicious but preserved',
    '',
    ...inventory.suspicious.flatMap((item) => [
      `### ${item.subject}`,
      '',
      item.behavior,
      '',
    ]),
  ].join('\n');
};

const output = join(appRoot, 'docs', 'permission-table.md');

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const document = renderPermissionTable(collectPermissionInventory());
  if (process.argv.includes('--check')) {
    if (readFileSync(output, 'utf8') !== document) {
      throw new Error('docs/permission-table.md is stale; run pnpm run permissions:generate');
    }
  } else {
    writeFileSync(output, document);
  }
}
