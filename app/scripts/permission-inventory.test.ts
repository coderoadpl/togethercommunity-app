import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  collectPermissionInventory,
  collectUseCasesInSource,
  renderPermissionTable,
} from './permission-inventory.js';

const root = join(import.meta.dirname, '..');

describe('permission inventory', () => {
  it('covers every runtime route and every exported Ctx use-case', () => {
    const inventory = collectPermissionInventory();
    expect(inventory.routes).toHaveLength(424);
    expect(inventory.useCases).toHaveLength(331);
    for (const row of [
      inventory.routes.find((entry) => entry.subject === 'POST /api/orders/:orderId/invoice/send'),
      inventory.useCases.find((entry) => entry.subject === 'invoices.ts#sendInvoice'),
    ]) {
      expect(row).toMatchObject({ capability: 'invoice:write', before: ['owner', 'admin'], after: ['owner', 'admin'] });
    }
    for (const row of [
      inventory.routes.find((entry) => entry.subject === 'POST /api/integrations/stripe/probe'),
      inventory.useCases.find((entry) => entry.subject === 'probe-stripe-permissions.ts#probeStripePermissions'),
    ]) {
      expect(row).toMatchObject({ capability: 'tenant:secret:write', before: ['owner'], after: ['owner'] });
    }
    for (const row of [
      inventory.routes.find((entry) => entry.subject === 'GET /api/orders/consumer-sales-summary'),
      inventory.useCases.find((entry) => entry.subject === 'consumer-sales.ts#summarizeUninvoicedConsumerSales'),
    ]) {
      expect(row).toMatchObject({ capability: 'order:export', before: ['owner', 'admin'], after: ['owner', 'admin'] });
    }
    for (const row of [
      inventory.routes.find((entry) => entry.subject === 'GET /api/download-copies'),
      inventory.routes.find((entry) => entry.subject === 'GET /api/orders/verify/:reference'),
      inventory.useCases.find((entry) => entry.subject === 'order-verification.ts#verifyOrder'),
      inventory.useCases.find((entry) => entry.subject === 'download-copies.ts#listDownloadCopies'),
    ]) {
      expect(row).toMatchObject({ capability: 'order:read', before: ['owner', 'admin'], after: ['owner', 'admin'] });
    }
    for (const row of [
      inventory.routes.find((entry) => entry.subject === 'POST /api/orders/:orderId/lines/:productId/issue'),
      inventory.useCases.find((entry) => entry.subject === 'order-verification.ts#issueOrderLine'),
    ]) {
      expect(row).toMatchObject({ capability: 'order:write', before: ['owner', 'admin'], after: ['owner', 'admin'] });
    }
    expect(inventory.routes.find((entry) => entry.subject === 'GET /api/public/orders/qr/:token'))
      .toMatchObject({ capability: 'offer:read', before: ['public'], after: ['public'] });
    expect(inventory.routes.every((row) => row.capability !== null)).toBe(true);
    expect(inventory.useCases.every((row) => row.capability !== null)).toBe(true);
    expect(inventory.sourceEvidence.filter((row) => row.kind === 'staff-role').length).toBeGreaterThan(0);
    expect(inventory.sourceEvidence.filter((row) => row.kind === 'api-key').length).toBeGreaterThan(5);
    expect(inventory.sourceEvidence.filter((row) => row.kind === 'member-scope').length).toBeGreaterThan(10);
  });

  it('keeps survey management staff-only and public answering open', () => {
    const inventory = collectPermissionInventory();
    for (const [subject, capability] of [
      ['GET /api/surveys', 'survey:read'],
      ['GET /api/surveys/:id/results', 'survey:read'],
      ['GET /api/surveys/:id/export', 'survey:read'],
      ['POST /api/surveys', 'survey:write'],
      ['POST /api/surveys/:id', 'survey:write'],
      ['POST /api/surveys/preview', 'survey:write'],
      ['DELETE /api/surveys/:id', 'survey:write'],
    ]) {
      expect(inventory.routes.find((row) => row.subject === subject))
        .toMatchObject({ capability, before: ['owner', 'admin'], after: ['owner', 'admin'] });
    }
    for (const subject of ['GET /api/public/surveys/:slug', 'POST /api/public/surveys/:slug/submit']) {
      expect(inventory.routes.find((row) => row.subject === subject))
        .toMatchObject({ capability: 'offer:read', evidence: 'public route manifest' });
    }
  });

  it('keeps edition writes staff-only and reader editions on the existing lesson capability', () => {
    const inventory = collectPermissionInventory();
    for (const action of ['mark', 'unmark']) {
      expect(inventory.routes.find((row) => row.subject === `POST /api/courses/history/edition/${action}`))
        .toMatchObject({ capability: 'course:write', after: ['owner', 'admin'] });
    }
    for (const name of ['getLessonEdition', 'listLessonEditions']) {
      expect(inventory.useCases.find((row) => row.subject === `lesson-editions.ts#${name}`))
        .toMatchObject({ capability: 'lesson:play', after: ['owner', 'admin', 'member'] });
    }
    for (const suffix of ['editions', 'editions/:number']) {
      expect(inventory.routes.find((row) => row.subject === `GET /api/student/lessons/:lessonId/${suffix}`))
        .toMatchObject({ capability: 'lesson:play', evidence: 'public route manifest' });
    }
  });

  it('keeps tenant provisioning and readiness operator-only at both boundaries', () => {
    const inventory = collectPermissionInventory();
    for (const [route, useCase, capability] of [
      ['POST /api/internal/tenants/provision', 'provision-tenant.ts#provisionTenant', 'tenant:provision'],
      ['GET /api/internal/tenants/:slug/readiness', 'operator-tenant-readiness.ts#getOperatorTenantReadiness', 'tenant:readiness'],
    ]) {
      for (const row of [
        inventory.routes.find((entry) => entry.subject === route),
        inventory.useCases.find((entry) => entry.subject === useCase),
      ]) {
        expect(row).toMatchObject({ capability, before: ['operator-secret'], after: ['operator-secret'] });
      }
    }
  });

  it('classifies report routes through the tenant API-key manifest', () => {
    const routes = collectPermissionInventory().routes;
    for (const path of ['activity-summary', 'member-activity']) {
      expect(routes.find((row) => row.subject === `GET /api/reports/${path}`)).toMatchObject({
        capability: 'report:read', before: ['report-api-key'], after: ['report-api-key'], evidence: 'Tenant API key',
      });
    }
  });

  it('machine-checks every derivable before and after principal set', () => {
    const inventory = collectPermissionInventory();
    const changes = [...inventory.routes, ...inventory.useCases]
      .filter((row) => row.derivable)
      .filter((row) => row.before.join(',') !== row.after.join(','));
    expect(changes).toEqual([]);
  });

  it('classifies member self-service routes for staff and completion writes consistently', () => {
    const routes = new Map(collectPermissionInventory().routes.map((row) => [row.subject, row]));
    for (const subject of [
      'POST /api/me/profile', 'GET /api/me/erasure-request', 'GET /api/me/data-export',
      'GET /api/student/progress', 'POST /api/student/progress/last-viewed',
      'POST /api/student/lessons/complete', 'POST /api/student/lessons/uncomplete',
    ]) {
      expect(routes.get(subject)?.after, subject).toEqual(['owner', 'admin', 'member']);
    }
    expect(routes.get('POST /api/student/lessons/uncomplete')?.capability).toBe('member:progress:self-write');
  });

  it('restricts permanent post deletion to staff in both inventories', () => {
    const inventory = collectPermissionInventory();
    for (const row of [
      inventory.routes.find((entry) => entry.subject === 'DELETE /api/posts/:postId/permanent'),
      inventory.useCases.find((entry) => entry.subject === 'community.ts#purgePost'),
    ]) {
      expect(row).toMatchObject({ capability: 'community:moderate', before: ['owner', 'admin'], after: ['owner', 'admin'] });
    }
  });

  it('classifies subscription routes and use-cases with dedicated capabilities', () => {
    const inventory = collectPermissionInventory();
    for (const [operation, method, capability, principal] of [
      ['stripe', 'GET', 'subscriptions:read', 'subscriptions-read-api-key'],
      ['adopt', 'POST', 'subscriptions:adopt', 'subscriptions-adopt-api-key'],
    ] as const) {
      expect(inventory.routes.find((row) => row.subject === `${method} /api/m2m/subscriptions/${operation}`))
        .toMatchObject({ capability, before: [principal], after: [principal] });
      expect(inventory.routes.find((row) => row.subject === `${method} /api/subscriptions/${operation}`))
        .toMatchObject({ capability, before: ['owner', 'admin'], after: ['owner', 'admin'] });
    }
    expect(inventory.useCases.find((row) => row.subject === 'stripe-subscription-adoption.ts#adoptStripeSubscription')?.capability)
      .toBe('subscriptions:adopt');
    expect(inventory.useCases.find((row) => row.subject === 'stripe-subscription-adoption.ts#listStripeSubscriptions')?.capability)
      .toBe('subscriptions:read');
  });

  it('reads use-case capabilities from their authorization calls', () => {
    const useCases = new Map(
      collectPermissionInventory().useCases.map((row) => [row.subject, row]),
    );
    expect(useCases.get('marketing-contacts.ts#listMarketingContacts')?.capability).toBe('marketing:contact:read');
    expect(useCases.get('marketing-contact-imports.ts#commitMarketingContactImport')?.capability).toBe('marketing:import:write');
    expect(useCases.get('marketing-contact-campaigns.ts#setMarketingCampaignAudience')?.capability).toBe('marketing:campaign:write');
    expect(useCases.get('marketing-contact-campaigns.ts#scheduleMarketingContactCampaign')?.capability).toBe('marketing:campaign:send');
    expect(useCases.get('marketing-contact-campaigns.ts#returnMarketingCampaignToDraft')?.capability).toBe('marketing:campaign:write');
    expect(useCases.get('marketing-contact-audience.ts#previewMarketingContactAudience')?.capability).toBe('marketing:campaign:read');
    expect(useCases.get('orders.ts#getSalesSummary')?.capability).toBe('sales:read');
    expect(useCases.get('marketing-email.ts#deleteCampaign')?.capability).toBe(
      'marketing:campaign:write',
    );
    expect(useCases.get('coupon-stats.ts#getCouponStats')?.capability).toBe('coupon:report');
    expect(useCases.get('lesson-playback.ts#getLessonPlayback')?.capability).toBe('lesson:play');
  });

  it('records the pre-migration marketing and route permissions', () => {
    const inventory = collectPermissionInventory();
    const useCases = new Map(inventory.useCases.map((row) => [row.subject, row]));
    const routes = new Map(inventory.routes.map((row) => [row.subject, row]));
    expect(useCases.get('marketing-email.ts#recordMarketingConsent')?.before).toEqual([
      'owner',
      'admin',
      'member',
      'authenticated',
    ]);
    expect(useCases.get('marketing-email.ts#createCampaign')?.before).toEqual([
      'owner',
      'admin',
    ]);
    expect(routes.get('GET /api/integrations/bunny/videos')).toMatchObject({
      capability: 'course:read',
      before: ['owner', 'admin'],
    });
    expect(routes.get('GET /api/coupons')).toMatchObject({
      capability: 'coupon:report',
    });
    expect(routes.get('GET /api/coupons/export')).toMatchObject({
      capability: 'coupon:report',
    });
  });

  it('keeps the known ambiguous behavior visible for owner review', () => {
    const suspicious = collectPermissionInventory().suspicious.map((item) => item.subject);
    expect(suspicious).toEqual(expect.arrayContaining([
      'development-only routes',
      'GET /api/tenant/settings',
      'marketing synthetic identities',
      'tenant creation mode',
      'staff lesson access',
    ]));
  });

  it('keeps the generated permission table current', () => {
    expect(readFileSync(join(root, 'docs', 'permission-table.md'), 'utf8')).toBe(
      renderPermissionTable(collectPermissionInventory()),
    );
  });
});

describe('use-case shape probe', () => {
  it('rejects exported function declarations', () => {
    const source = `
      export function getThing(context: Ctx) {
        return staffTenantIdFrom(context, 'product:read');
      }
    `;
    expect(() => collectUseCasesInSource('probe.ts', source)).toThrow(
      /function declarations are not classified/,
    );
  });

  it('rejects inline ctx types', () => {
    const source = `
      export const getThing = async (ctx: { identity: Identity }) =>
        staffTenantIdFrom(ctx, 'product:read');
    `;
    expect(() => collectUseCasesInSource('probe.ts', source)).toThrow(
      /inline ctx types are not classified/,
    );
  });

  it('rejects intersection ctx types', () => {
    const source = `
      export const getThing = async (
        context: Ctx & { capabilities: readonly Capability[] },
      ) => staffTenantIdFrom(context, 'product:read');
    `;
    expect(() => collectUseCasesInSource('probe.ts', source)).toThrow(
      /inline ctx types are not classified/,
    );
  });

  it('classifies canonical exported const arrow functions', () => {
    const source = `
      export const getThing = async (ctx: Ctx) =>
        staffTenantIdFrom(ctx, 'product:read');
    `;
    expect(collectUseCasesInSource('probe.ts', source)).toEqual([
      {
        name: 'getThing',
        file: 'probe.ts',
        capability: 'product:read',
      },
    ]);
  });
});
