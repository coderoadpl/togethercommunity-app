import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  collectPermissionInventory,
  renderPermissionTable,
} from './permission-inventory.js';

const root = join(import.meta.dirname, '..');

describe('permission inventory', () => {
  it('covers every runtime route and every exported Ctx use-case', () => {
    const inventory = collectPermissionInventory();
    expect(inventory.routes).toHaveLength(194);
    expect(inventory.useCases).toHaveLength(170);
    expect(inventory.routes.every((row) => row.capability !== null)).toBe(true);
    expect(inventory.useCases.every((row) => row.capability !== null)).toBe(true);
    expect(inventory.sourceEvidence.filter((row) => row.kind === 'staff-role').length).toBeGreaterThan(0);
    expect(inventory.sourceEvidence.filter((row) => row.kind === 'api-key').length).toBeGreaterThan(5);
    expect(inventory.sourceEvidence.filter((row) => row.kind === 'member-scope').length).toBeGreaterThan(10);
  });

  it('machine-checks every derivable before and after principal set', () => {
    const inventory = collectPermissionInventory();
    const changes = [...inventory.routes, ...inventory.useCases]
      .filter((row) => row.derivable)
      .filter((row) => row.before.join(',') !== row.after.join(','));
    expect(changes).toEqual([]);
  });

  it('reads use-case capabilities from their authorization calls', () => {
    const useCases = new Map(
      collectPermissionInventory().useCases.map((row) => [row.subject, row]),
    );
    expect(useCases.get('orders.ts#getSalesSummary')?.capability).toBe('sales:read');
    expect(useCases.get('marketing-email.ts#deleteCampaign')?.capability).toBe(
      'marketing:campaign:write',
    );
    expect(useCases.get('coupon-stats.ts#getCouponStats')?.capability).toBe('coupon:report');
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
