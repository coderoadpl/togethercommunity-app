import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  if (path === '/api/my/products') return 'member:product:read';
  if (path === '/api/members') return 'member:read';
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
  if (path.startsWith('/api/onboarding')) return method === 'GET' ? 'tenant:onboarding:read' : 'tenant:onboarding:write';
  if (path.startsWith('/api/integrations/')) return 'integration:test';
  if (path === '/api/products') return method === 'GET' ? 'product:read' : 'product:write';
  if (path.endsWith('/publish')) return 'product:publish';
  if (path.endsWith('/access-items')) return 'product:access:write';
  if (path.endsWith('/access-issues')) return 'product:access:read';
  if (path.includes('/prices')) return method === 'GET' ? 'product:price:read' : 'product:price:write';
  if (path === '/api/orders' || /^\/api\/orders\/:[^/]+$/.test(path)) return 'order:read';
  if (path === '/api/orders/export') return 'order:export';
  if (path === '/api/sales/summary') return 'sales:read';
  if (path.includes('/invoice') || path.includes('/invoices/')) {
    if (path.startsWith('/api/me/')) return 'invoice:member-read';
    return method === 'GET' ? 'invoice:read' : 'invoice:write';
  }
  if (path.startsWith('/api/coupons')) {
    if (path.includes('/stats')) return 'coupon:report';
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
  if (path === '/api/me/billing-orders' || path === '/api/my/products' || path.startsWith('/api/me/invoices/')) return member;
  if (path.startsWith('/api/student/')) {
    return capabilityForRoute(method, path) === 'lesson:play' ? tenantActors : member;
  }
  if (path === '/api/tenant/settings' && method === 'GET') return tenantActors;
  if (path.startsWith('/api/posts') || path.startsWith('/api/discussion') || path.startsWith('/api/threads') || path.startsWith('/api/notifications')) return tenantActors;
  if (path.startsWith('/api/spaces') && path !== '/api/spaces/staff' && method === 'GET') return tenantActors;
  if (path.includes('/follow') || path.includes('/react')) return tenantActors;
  if (
    (path === '/api/tenant/settings' && method !== 'GET')
    || (path.startsWith('/api/tenant-secrets') && method !== 'GET')
    || (path.startsWith('/api/api-keys') && method !== 'GET')
    || path.startsWith('/api/integrations/')
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

interface CollectedUseCase {
  name: string;
  file: string;
  body: string;
}

const collectCtxUseCases = (): CollectedUseCase[] => {
  const found: CollectedUseCase[] = [];
  const pattern = /export const (\w+)\s*=\s*(?:async\s*)?\(\s*ctx:\s*Ctx\b/g;
  for (const file of readdirSync(useCasesRoot).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts')).sort()) {
    const source = readFileSync(join(useCasesRoot, file), 'utf8');
    const matches = [...source.matchAll(pattern)];
    matches.forEach((match, index) => {
      const name = match[1];
      const start = match.index ?? 0;
      const end = matches[index + 1]?.index ?? source.length;
      if (name !== undefined) found.push({ name, file, body: source.slice(start, end) });
    });
  }
  return found;
};

const capabilityForUseCase = (file: string, name: string): Capability | null => {
  if (file === 'api-keys.ts') return name === 'listTenantApiKeys' ? 'api-key:read' : 'api-key:write';
  if (file === 'bunny-videos.ts') return name === 'listBunnyVideos' ? 'course:read' : 'integration:test';
  if (file === 'community-access.ts') return name.includes('space') || name.includes('Space') ? 'space:read' : 'community:read';
  if (file === 'community.ts') {
    if (name.includes('Notification')) return name.startsWith('list') || name.startsWith('unread') ? 'notification:read' : 'notification:write';
    return name === 'listDiscussion' || name === 'searchPosts' ? 'community:read' : 'community:write';
  }
  if (file === 'content-history.ts') return 'course:history:read';
  if (file === 'coupon-management.ts') return 'coupon:write';
  if (file === 'coupon-stats.ts') return name === 'listCouponOptions' ? 'coupon:read' : 'coupon:report';
  if (file === 'course-management.ts') {
    if (name.startsWith('list')) return name === 'listLessonReferences' ? 'product:access:read' : 'course:read';
    return name === 'updateProductAccessItems' ? 'product:access:write' : 'course:write';
  }
  if (file === 'create-tenant.ts') return 'tenant:create';
  if (file === 'email-reputation.ts') return 'marketing:reputation:read';
  if (file === 'email-send-observability.ts') return 'marketing:delivery:read';
  if (file === 'entitlements.ts') return name === 'resolveMemberEntitlements' ? 'member:product:read' : 'lesson:play';
  if (file === 'grants.ts') return name === 'listMemberGrants' ? 'member:grant:read' : 'member:grant:write';
  if (file === 'invoices.ts') {
    if (name === 'downloadMemberInvoice') return 'invoice:member-read';
    if (name.startsWith('test')) return 'integration:test';
    return name.startsWith('download') ? 'invoice:read' : 'invoice:write';
  }
  if (file === 'lesson-media.ts') return 'lesson:play';
  if (file === 'marketing-email.ts') {
    if (name === 'createMarketingConsentDefinition') return 'marketing:consent-definition:write';
    if (name === 'listMarketingConsentDefinitions') return 'marketing:consent-definition:read';
    if (name.includes('Campaign') || name.includes('campaign')) {
      if (name.startsWith('get') || name.startsWith('list')) return 'marketing:campaign:read';
      if (name === 'campaignTick') return 'marketing:campaign:dispatch';
      if (name.startsWith('schedule') || name.startsWith('send') || name.startsWith('test')) return 'marketing:campaign:send';
      return 'marketing:campaign:write';
    }
    if (name.includes('Suppression')) return name.startsWith('get') || name.startsWith('list') ? 'marketing:suppression:read' : 'marketing:suppression:write';
    if (name.includes('Message') || name.includes('Idempot')) return name.startsWith('send') ? 'marketing:message:send' : 'marketing:message:read';
    if (name.includes('Retention') || name.includes('Scheduled')) return 'scheduler:dispatch';
    if (name === 'applyVerifiedSesEvent') return 'webhook:process';
    return name.startsWith('get') || name.startsWith('list') ? 'marketing:consent:read' : 'marketing:consent:write';
  }
  if (file === 'marketing-management.ts') {
    if (name.includes('Document')) return name.startsWith('get') || name.startsWith('list') ? 'marketing:document:read' : 'marketing:document:write';
    if (name.includes('Layout')) return name.startsWith('list') ? 'marketing:layout:read' : 'marketing:layout:write';
    if (name.includes('Campaign') || name.includes('Audience')) return name.startsWith('preview') ? 'marketing:campaign:read' : 'marketing:campaign:write';
    if (name.includes('Ses')) return name.startsWith('get') ? 'marketing:ses:read' : 'marketing:ses:write';
    if (name.includes('Smtp')) return 'marketing:ses:write';
    return name.startsWith('get') ? 'marketing:consent-definition:read' : 'marketing:consent-definition:write';
  }
  if (file === 'marketing-ses-onboarding.ts') return 'marketing:ses:write';
  if (file === 'member-billing-orders.ts') return 'member:billing:read';
  if (file === 'member-learning.ts') return 'member:learning:read';
  if (file === 'members.ts') return name === 'listMembers' ? 'member:read' : name === 'exportMembers' ? 'member:export' : 'member:remove';
  if (file === 'my-products.ts') return 'member:product:read';
  if (file === 'onboarding.ts') return name.startsWith('get') ? 'tenant:onboarding:read' : 'tenant:onboarding:write';
  if (file === 'orders.ts') return name === 'exportOrders' ? 'order:export' : name === 'getSalesSummary' ? 'sales:read' : 'order:read';
  if (file === 'payment-integrations.ts') return 'integration:test';
  if (file === 'product-access-issues.ts') return 'product:access:read';
  if (file === 'product-prices.ts') return name.startsWith('list') ? 'product:price:read' : 'product:price:write';
  if (file === 'products.ts') return name === 'listProducts' ? 'product:read' : name === 'publishProduct' ? 'product:publish' : 'product:write';
  if (file === 'progress.ts') return name === 'getProgress' ? 'member:progress:read' : name === 'resetMemberCourseProgress' ? 'member:progress:manage' : 'member:progress:self-write';
  if (file === 'scheduler-activity.ts') return 'scheduler:read';
  if (file === 'spaces.ts') {
    if (name.includes('follow') || name.includes('Follow') || name.includes('react') || name.includes('React')) return 'space:interact';
    return name.startsWith('create') || name.startsWith('update') || name.startsWith('delete') || name.startsWith('set') || name === 'listSpacesForStaff' ? 'space:write' : 'space:read';
  }
  if (file === 'tenant-secrets.ts') return name === 'getTenantSecretsMasked' ? 'tenant:secret:read' : 'tenant:secret:write';
  if (file === 'tenant-settings.ts') return name === 'getTenantSettings' ? 'tenant:settings:read' : 'tenant:settings:write';
  if (file === 'tenants.ts') return 'tenant:list-own';
  return null;
};

const beforeForUseCase = (
  file: string,
  name: string,
  body: string,
  capability: Capability | null,
): readonly Principal[] => {
  if (capability === null) return [];
  if (body.includes('staffTenantIdFrom(ctx)')) return staff;
  if (body.includes('tenantIdFrom(ctx)')) return allHumans;
  if (file === 'create-tenant.ts') return allHumans;
  if (file === 'member-billing-orders.ts' || file === 'my-products.ts' || capability === 'invoice:member-read') return member;
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
  if (file === 'spaces.ts') return name === 'listSpacesForStaff' || capability === 'space:write' ? staff : tenantActors;
  if (capability === 'tenant:list-own') return allHumans;
  return staff;
};

const useCaseRows = (): PermissionRow[] =>
  collectCtxUseCases().map(({ file, name, body }) => {
    const capability = capabilityForUseCase(file, name);
    const before = beforeForUseCase(file, name, body, capability);
    return {
      subject: `${file}#${name}`,
      capability,
      before,
      after: capability === null ? [] : effectiveAfter(before, capability),
      derivable: capability !== null,
      evidence: `${relative(appRoot, join(useCasesRoot, file))} inline guard or same-file guard helper`,
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
    behavior: 'When the composition flag is enabled, these routes have no session or secret check; the flag alone is the current control.',
  },
  {
    subject: 'GET /api/tenant/settings',
    behavior: 'The use-case checks only tenantId, so a member can read tenant settings while updates remain owner-only.',
  },
  {
    subject: 'marketing synthetic identities',
    behavior: 'API-key, worker, checkout, unsubscribe, and webhook handlers synthesize Identity values; several marketing use-cases check only tenant context rather than the originating credential type.',
  },
  {
    subject: 'tenant creation mode',
    behavior: 'The route supplies a tenantless authenticated identity, while direct use-case callers may also carry a staff or member grant; the deployment mode separately denies all creation when closed.',
  },
  {
    subject: 'staff with simultaneous membership',
    behavior: 'Identity resolution can carry both staffRole and memberId; staff checks take precedence in some use-cases while member-scoped use-cases accept the same identity through memberId.',
  },
  {
    subject: 'staff lesson access',
    behavior: 'Staff identities can use the student lesson and course-structure use-cases without a member row or product grant.',
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
    'Generated by `npm run permissions:generate`. Do not edit by hand.',
    '',
    'BEFORE records the current edge middleware, inline checks, same-file guard helpers, API-key checks, token checks, webhook verification, and public manifests. AFTER records the effective principal set after the capability is applied at the same edge. The generator fails when a derivable row differs.',
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
      throw new Error('docs/permission-table.md is stale; run npm run permissions:generate');
    }
  } else {
    writeFileSync(output, document);
  }
}
