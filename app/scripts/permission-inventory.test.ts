import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  collectPermissionInventory,
  collectUseCasesInSource,
  KEY_MODE_ROUTES,
  renderPermissionTable,
  SHOP_MANAGEMENT_KEY_PRINCIPAL,
  SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL,
  type PermissionInventory,
} from './permission-inventory.js';

const root = join(import.meta.dirname, '..');

describe('permission inventory', () => {
  it('covers every runtime route and every exported Ctx use-case', () => {
    const inventory = collectPermissionInventory();
    expect(inventory.routes).toHaveLength(560);
    expect(inventory.useCases).toHaveLength(421);
    expect(inventory.routes.filter((entry) => entry.modes !== undefined).map((entry) => entry.subject).sort())
      .toEqual(Object.keys(KEY_MODE_ROUTES).sort());
    expect(inventory.useCases.filter((entry) => entry.modes !== undefined).map((entry) => entry.subject)).toEqual(
      ['beginKeyDownloadUpload', 'completeKeyDownloadUpload', 'copyKeyDownloadFile', 'listKeyDownloadFiles', 'discardKeyDownloadFile']
        .map((name) => `key-download-files.ts#${name}`),
    );
    expect(inventory.routes.find((entry) => entry.subject === 'OPTIONS /api/public/sales-links/:slug'))
      .toMatchObject({ capability: 'offer:read', before: ['public'], after: ['public'] });
    expect(inventory.routes.find((entry) => entry.subject === 'GET /api/public/parcel-lockers/:code'))
      .toMatchObject({ capability: 'checkout:read', before: ['public'], after: ['public'] });
    for (const row of [
      inventory.routes.find((entry) => entry.subject === 'POST /api/products/stock/adjust'),
      inventory.useCases.find((entry) => entry.subject === 'stock.ts#adjustProductStock'),
    ]) {
      expect(row).toMatchObject({ capability: 'product:write', before: ['owner', 'admin'], after: ['owner', 'admin'] });
    }
    expect(inventory.routes.filter((entry) => entry.evidence === 'Shop management key')).toHaveLength(49);
    expect(inventory.routes.find((entry) => entry.subject === 'POST /api/m2m/shop/products/stock/adjust'))
      .toMatchObject({ capability: 'product:write', before: [SHOP_MANAGEMENT_KEY_PRINCIPAL], after: [SHOP_MANAGEMENT_KEY_PRINCIPAL] });
    expect(inventory.routes.find((entry) => entry.subject === 'POST /api/m2m/shop/integrations/stripe/configure'))
      .toMatchObject({ capability: 'tenant:secret:write', before: [SHOP_MANAGEMENT_KEY_PRINCIPAL], after: [SHOP_MANAGEMENT_KEY_PRINCIPAL] });
    const shopRoutes = inventory.routes.filter((entry) => entry.subject.includes(' /api/m2m/shop/'));
    expect(shopRoutes).toHaveLength(64);
    for (const row of shopRoutes) {
      if (row.subject.includes('/purchase-smoke/')) {
        expect(row).toMatchObject({ capability: 'purpose:purchase-smoke', before: ['purchase-smoke key (exclusive fixture purpose)'], after: ['purchase-smoke key (exclusive fixture purpose)'] });
        continue;
      }
      const isAccessRoute = row.subject === 'POST /api/m2m/shop/products/access';
      const principals = isAccessRoute || row.subject.includes(' /api/m2m/shop/proposals')
        ? [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL]
        : row.subject.startsWith('GET ') && row.modes === undefined
          ? [SHOP_MANAGEMENT_KEY_PRINCIPAL, SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL]
          : [SHOP_MANAGEMENT_KEY_PRINCIPAL];
      expect(row, row.subject).toMatchObject({ before: principals, after: principals, derivable: true });
      expect([...row.before, ...row.after], row.subject).not.toContain('owner');
      if (row.modes !== undefined) {
        const directPrincipals = isAccessRoute ? [] : [SHOP_MANAGEMENT_KEY_PRINCIPAL];
        expect(row.modes.direct, row.subject).toMatchObject({ principal: SHOP_MANAGEMENT_KEY_PRINCIPAL, before: directPrincipals, after: directPrincipals });
        expect(row.modes.propose, row.subject).toMatchObject({
          principal: SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL, before: [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL], after: [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL],
        });
        for (const mode of [row.modes.direct, row.modes.propose]) {
          expect([...mode.before, ...mode.after], row.subject).not.toContain('owner');
        }
      }
    }
    for (const row of [
      inventory.routes.find((entry) => entry.subject === 'POST /api/orders/:orderId/invoice/send'),
      inventory.useCases.find((entry) => entry.subject === 'invoices.ts#sendInvoice'),
    ]) {
      expect(row).toMatchObject({ capability: 'invoice:write', before: ['owner', 'admin'], after: ['owner', 'admin'] });
    }
    for (const row of [
      inventory.routes.find((entry) => entry.subject === 'GET /api/orders/changes'),
      inventory.useCases.find((entry) => entry.subject === 'order-changes.ts#listOrderChangeFeed'),
    ]) {
      expect(row).toMatchObject({ capability: 'order:read', before: ['owner', 'admin'], after: ['owner', 'admin'] });
    }
    for (const row of [
      inventory.routes.find((entry) => entry.subject === 'POST /api/integrations/stripe/probe'),
      inventory.useCases.find((entry) => entry.subject === 'probe-stripe-permissions.ts#probeStripePermissions'),
      inventory.routes.find((entry) => entry.subject === 'POST /api/integrations/shipx/configure'),
      inventory.useCases.find((entry) => entry.subject === 'shipx.ts#configureShipx'),
    ]) {
      expect(row).toMatchObject({ capability: 'tenant:secret:write', before: ['owner'], after: ['owner'] });
    }
    for (const row of [
      inventory.routes.find((entry) => entry.subject === 'GET /api/integrations/shipx'),
      inventory.useCases.find((entry) => entry.subject === 'shipx.ts#getShipxSettings'),
    ]) {
      expect(row).toMatchObject({ capability: 'tenant:secret:read', before: ['owner', 'admin'], after: ['owner', 'admin'] });
    }
    for (const row of [
      inventory.routes.find((entry) => entry.subject === 'GET /api/orders/consumer-sales-summary'),
      inventory.useCases.find((entry) => entry.subject === 'consumer-sales.ts#summarizeUninvoicedConsumerSales'),
      inventory.routes.find((entry) => entry.subject === 'GET /api/orders/packing-list'),
      inventory.useCases.find((entry) => entry.subject === 'order-fulfilment.ts#exportPackingList'),
    ]) {
      expect(row).toMatchObject({ capability: 'order:export', before: ['owner', 'admin'], after: ['owner', 'admin'] });
    }
    for (const row of [
      inventory.routes.find((entry) => entry.subject === 'GET /api/download-copies'),
      inventory.routes.find((entry) => entry.subject === 'GET /api/orders/verify/:reference'),
      inventory.useCases.find((entry) => entry.subject === 'order-verification.ts#verifyOrder'),
      inventory.useCases.find((entry) => entry.subject === 'download-copies.ts#listDownloadCopies'),
      inventory.routes.find((entry) => entry.subject === 'GET /api/orders/:orderId/shipx'),
      inventory.useCases.find((entry) => entry.subject === 'shipx.ts#getInpostShipment'),
    ]) {
      expect(row).toMatchObject({ capability: 'order:read', before: ['owner', 'admin'], after: ['owner', 'admin'] });
    }
    for (const row of [
      inventory.routes.find((entry) => entry.subject === 'POST /api/orders/:orderId/lines/:productId/issue'),
      inventory.useCases.find((entry) => entry.subject === 'order-verification.ts#issueOrderLine'),
      inventory.routes.find((entry) => entry.subject === 'POST /api/orders/:orderId/ship'),
      inventory.useCases.find((entry) => entry.subject === 'order-fulfilment.ts#shipOrder'),
      inventory.routes.find((entry) => entry.subject === 'POST /api/orders/:orderId/shipx'),
      inventory.useCases.find((entry) => entry.subject === 'shipx.ts#createInpostShipment'),
      inventory.routes.find((entry) => entry.subject === 'POST /api/orders/:orderId/shipx/discard'),
      inventory.useCases.find((entry) => entry.subject === 'shipx.ts#discardInpostShipmentAttempt'),
      inventory.routes.find((entry) => entry.subject === 'POST /api/orders/:orderId/shipx/refresh'),
      inventory.useCases.find((entry) => entry.subject === 'shipx.ts#refreshInpostShipment'),
      inventory.routes.find((entry) => entry.subject === 'POST /api/orders/:orderId/shipx/label'),
      inventory.useCases.find((entry) => entry.subject === 'shipx.ts#inpostShipmentLabel'),
    ]) {
      expect(row).toMatchObject({ capability: 'order:write', before: ['owner', 'admin'], after: ['owner', 'admin'] });
    }
    expect(inventory.routes.find((entry) => entry.subject === 'GET /api/orders/:orderId/shipx/label')).toBeUndefined();
    expect(inventory.routes.find((entry) => entry.subject === 'GET /api/public/orders/qr/:token'))
      .toMatchObject({ capability: 'offer:read', before: ['public'], after: ['public'] });
    for (const row of [
      inventory.routes.find((entry) => entry.subject === "GET /api/meta-capi/events"),
      inventory.useCases.find((entry) => entry.subject === "meta-capi.ts#listMetaCapiEvents"),
    ]) {
      expect(row).toMatchObject({ capability: "tenant:settings:write", before: ["owner"], after: ["owner"] });
    }
    expect(inventory.routes.find((entry) => entry.subject === "POST /api/public/meta-capi/consent"))
      .toMatchObject({ capability: "marketing:consent:write", before: ["token"], after: ["token"] });
    expect(inventory.routes.every((row) => row.capability !== null)).toBe(true);
    expect(inventory.useCases.every((row) => row.capability !== null)).toBe(true);
    expect(inventory.sourceEvidence.filter((row) => row.kind === 'staff-role').length).toBeGreaterThan(0);
    expect(inventory.sourceEvidence.filter((row) => row.kind === 'api-key').length).toBeGreaterThan(5);
    expect(inventory.sourceEvidence.filter((row) => row.kind === 'member-scope').length).toBeGreaterThan(10);
  });

  it('separates staff settings from member settings at both boundaries', () => {
    const inventory = collectPermissionInventory();
    for (const [route, useCase, capability, principals] of [
      ['GET /api/tenant/settings', 'getTenantSettings', 'tenant:settings:read', ['owner', 'admin']],
      ['GET /api/member/settings', 'getMemberSettings', 'member:settings:read', ['owner', 'admin', 'member']],
    ] as const) {
      for (const row of [
        inventory.routes.find((entry) => entry.subject === route),
        inventory.useCases.find((entry) => entry.subject === `tenant-settings.ts#${useCase}`),
      ]) {
        expect(row).toMatchObject({ capability, before: principals, after: principals });
      }
    }
  });

  it('keeps team reads and writes owner-only', () => {
    const inventory = collectPermissionInventory();
    for (const [route, useCase] of [
      ['GET /api/tenant/team', 'listTenantTeam'],
      ['POST /api/tenant/team', 'addTenantAdmin'],
      ['POST /api/tenant/team/remove', 'removeTenantAdmin'],
    ]) {
      for (const row of [
        inventory.routes.find((entry) => entry.subject === route),
        inventory.useCases.find((entry) => entry.subject === `tenant-team.ts#${useCase}`),
      ]) {
        expect(row).toMatchObject({ capability: 'tenant:settings:write', before: ['owner'], after: ['owner'] });
      }
    }
  });

  it('keeps catalog cleanup staff-only at both boundaries', () => {
    const inventory = collectPermissionInventory();
    for (const [route, useCase, capability] of [
      ['POST /api/courses/archive', 'course-management.ts#archiveCourse', 'course:write'],
      ['POST /api/courses/restore', 'course-management.ts#restoreCourse', 'course:write'],
      ['POST /api/products/delete', 'product-drafts.ts#deleteProductDraft', 'product:write'],
    ]) {
      for (const row of [
        inventory.routes.find((entry) => entry.subject === route),
        inventory.useCases.find((entry) => entry.subject === useCase),
      ]) {
        expect(row).toMatchObject({ capability, before: ['owner', 'admin'], after: ['owner', 'admin'] });
      }
    }
  });

  it('keeps all tenant settings updates owner-only', () => {
    const inventory = collectPermissionInventory();
    for (const row of [
      inventory.routes.find((entry) => entry.subject === 'POST /api/tenant/settings'),
      inventory.useCases.find((entry) => entry.subject === 'tenant-settings.ts#updateTenantSettings'),
    ]) {
      expect(row).toMatchObject({
        capability: 'tenant:settings:write',
        before: ['owner'],
        after: ['owner'],
      });
    }
  });

  it('classifies sales-link handoffs as public reads and session creation as checkout start', () => {
    const inventory = collectPermissionInventory();
    for (const [subject, capability] of [
      ['GET /offer/:slug', 'offer:read'],
      ['GET /api/public/checkout/session-status', 'checkout:read'],
      ['POST /api/public/sales-links/:slug/checkout', 'checkout:start'],
    ]) {
      expect(inventory.routes.find((row) => row.subject === subject))
        .toMatchObject({ capability, before: ['public'], after: ['public'], evidence: 'public route manifest' });
    }
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

  it('never lists a propose-mode shop management key with a live write', () => {
    const inventory = collectPermissionInventory();
    const liveWrites = ['product:write', 'product:price:write', 'product:publish', 'order:write', 'tenant:settings:write', 'tenant:secret:write'];
    const proposeRows = inventory.routes.filter((row) =>
      row.modes === undefined && [...row.before, ...row.after].includes(SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL));
    expect(proposeRows.length).toBeGreaterThan(0);
    for (const row of proposeRows) {
      expect(row.subject, row.subject).toMatch(/^(?:GET \/api\/m2m\/shop\/|[A-Z]+ \/api\/m2m\/shop\/proposals(?:\/|$))/u);
      expect(liveWrites, row.subject).not.toContain(row.capability);
    }
    const modeRows = inventory.routes.filter((row) => row.modes !== undefined);
    expect(modeRows).toHaveLength(13);
    for (const row of modeRows) {
      expect(row.subject, row.subject).toMatch(/^[A-Z]+ \/api\/m2m\/shop\//u);
      expect(row.modes?.propose.capabilities.filter((capability) => liveWrites.includes(capability)), row.subject).toEqual([]);
      if ([...row.before, ...row.after].includes(SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL)) {
        expect(liveWrites, row.subject).not.toContain(row.capability);
      }
    }
    for (const subject of ['POST /api/m2m/shop/products/update', 'POST /api/m2m/shop/settings', 'POST /api/m2m/shop/sales-links', 'DELETE /api/m2m/shop/sales-links/:id']) {
      expect(inventory.routes.find((row) => row.subject === subject)?.after, subject)
        .toEqual([SHOP_MANAGEMENT_KEY_PRINCIPAL]);
    }
  });

  it('gives the key-side proposal routes only to the propose-mode key and the session proposal routes only to the owner', () => {
    const inventory = collectPermissionInventory();
    for (const subject of [
      'GET /api/m2m/shop/proposals', 'GET /api/m2m/shop/proposals/:id', 'POST /api/m2m/shop/proposals/:id/withdraw',
      'POST /api/m2m/shop/proposals/groups', 'GET /api/m2m/shop/proposals/groups/:id', 'POST /api/m2m/shop/proposals/groups/:id/withdraw',
    ]) {
      expect(inventory.routes.find((row) => row.subject === subject), subject).toMatchObject({
        capability: 'proposal:own:manage', before: [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL], after: [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL],
      });
    }
    for (const [subject, capability] of [
      ['GET /api/change-proposals', 'proposal:read'],
      ['GET /api/change-proposals/summary', 'proposal:read'],
      ['GET /api/change-proposals/:id', 'proposal:read'],
      ['POST /api/change-proposals/:id/reject', 'proposal:decide'],
      ['POST /api/change-proposals/:id/approve', 'proposal:decide'],
      ['GET /api/change-proposals/:id/assets/:digest', 'proposal:read'],
      ['GET /api/change-proposals/:id/files/:fileId', 'proposal:read'],
      ['GET /api/change-proposals/groups/:id', 'proposal:read'],
      ['POST /api/change-proposals/groups/:id/reject', 'proposal:decide'],
      ['POST /api/change-proposals/groups/:id/approve', 'proposal:decide'],
    ] as const) {
      expect(inventory.routes.find((row) => row.subject === subject), subject).toMatchObject({ capability, before: ['owner'], after: ['owner'] });
    }
  });

  it('gives the change proposal use-cases to the propose-mode key on its side and to the owner on the decision side', () => {
    const useCases = collectPermissionInventory().useCases.filter((row) => row.subject.startsWith('change-proposals.ts#'));
    expect(useCases.map(({ subject, capability, after }) => [subject.replace('change-proposals.ts#', ''), capability, after])).toEqual([
      ['submitChangeProposal', 'proposal:submit:catalog', [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL]],
      ['listOwnChangeProposals', 'proposal:own:manage', [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL]],
      ['getOwnChangeProposal', 'proposal:own:manage', [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL]],
      ['withdrawOwnChangeProposal', 'proposal:own:manage', [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL]],
      ['listChangeProposals', 'proposal:read', ['owner']],
      ['getChangeProposalSummary', 'proposal:read', ['owner']],
      ['getChangeProposal', 'proposal:read', ['owner']],
      ['rejectChangeProposal', 'proposal:decide', ['owner']],
      ['approveChangeProposal', 'proposal:decide', ['owner']],
    ]);
  });

  it('gives the change proposal group use-cases to the propose-mode key on its side and to the owner on the decision side', () => {
    const useCases = collectPermissionInventory().useCases.filter((row) => row.subject.startsWith('change-proposal-groups.ts#'));
    expect(useCases.map(({ subject, capability, after }) => [subject.replace('change-proposal-groups.ts#', ''), capability, after])).toEqual([
      ['createChangeProposalGroup', 'proposal:own:manage', [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL]],
      ['submitGroupedChangeProposal', 'proposal:submit:catalog', [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL]],
      ['getOwnChangeProposalGroup', 'proposal:own:manage', [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL]],
      ['withdrawOwnChangeProposalGroup', 'proposal:own:manage', [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL]],
      ['getChangeProposalGroup', 'proposal:read', ['owner']],
      ['rejectChangeProposalGroup', 'proposal:decide', ['owner']],
      ['approveChangeProposalGroup', 'proposal:decide', ['owner']],
    ]);
  });

  it('gives the proposal image uploads to the propose-mode key and the image preview to the owner', () => {
    const useCases = collectPermissionInventory().useCases.filter((row) => row.subject.startsWith('change-proposal-images.ts#'));
    expect(useCases.map(({ subject, capability, after }) => [subject.replace('change-proposal-images.ts#', ''), capability, after])).toEqual([
      ['beginProposedProductCoverUpload', 'proposal:asset:upload', [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL]],
      ['beginProposedBrandingAssetUpload', 'proposal:asset:upload', [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL]],
      ['completeProposedProductCoverUpload', 'proposal:asset:upload', [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL]],
      ['completeProposedBrandingAssetUpload', 'proposal:asset:upload', [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL]],
      ['getChangeProposalImage', 'proposal:read', ['owner']],
    ]);
  });

  it('lists each key mode of a route that both modes reach with the capabilities and effect of that mode', () => {
    const routes = new Map(collectPermissionInventory().routes.map((row) => [row.subject, row]));
    const proposeKey = [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL];
    const directKey = [SHOP_MANAGEMENT_KEY_PRINCIPAL];
    for (const [route, direct, propose] of [
      ['POST /api/m2m/shop/downloads/upload', 'product:write', 'proposal:asset:upload + proposal:submit:catalog'],
      ['POST /api/m2m/shop/downloads/complete', 'product:write', 'proposal:asset:upload + proposal:submit:catalog'],
      ['POST /api/m2m/shop/downloads/copy', 'product:write + product:read', 'proposal:asset:upload + proposal:submit:catalog + product:read'],
      ['GET /api/m2m/shop/downloads/staged', 'product:write', 'proposal:asset:upload + proposal:submit:catalog'],
      ['DELETE /api/m2m/shop/downloads/staged/:id', 'product:write', 'proposal:asset:upload + proposal:submit:catalog'],
      ['POST /api/m2m/shop/image-assets/product-cover/upload', 'product:write', 'proposal:asset:upload + proposal:submit:catalog'],
      ['POST /api/m2m/shop/image-assets/product-cover/complete', 'product:write', 'proposal:asset:upload + proposal:submit:catalog'],
      ['POST /api/m2m/shop/image-assets/branding/upload', 'tenant:settings:write', 'proposal:asset:upload + proposal:submit:settings'],
      ['POST /api/m2m/shop/image-assets/branding/complete', 'tenant:settings:write', 'proposal:asset:upload + proposal:submit:settings'],
      ['POST /api/m2m/shop/products/access', 'product:access:write', 'proposal:submit:catalog + product:read'],
      ['POST /api/m2m/shop/products/downloads', 'product:write', 'proposal:submit:catalog + product:read'],
      ['POST /api/m2m/shop/products/downloads/replace', 'product:write', 'proposal:submit:catalog + product:read'],
      ['POST /api/m2m/shop/products/downloads/remove', 'product:write', 'proposal:submit:catalog + product:read'],
    ] as const) {
      const row = routes.get(route);
      const directRow = row?.modes?.direct;
      const proposeRow = row?.modes?.propose;
      const isAccessRoute = route === 'POST /api/m2m/shop/products/access';
      const directPrincipals = isAccessRoute ? [] : directKey;
      expect(directRow, route).toMatchObject({ capability: direct.split(' + ')[0], capabilities: direct.split(' + '), before: directPrincipals, after: directPrincipals });
      expect(directRow?.evidence, route).toMatch(new RegExp(`^Shop management key, direct mode: ${direct.replaceAll('+', '\\+')}; `, 'u'));
      expect(directRow?.evidence, route).toBe(`Shop management key, direct mode: ${direct}; ${directRow?.effect ?? ''}`);
      expect(proposeRow, route).toMatchObject({ capability: propose.split(' + ')[0], capabilities: propose.split(' + '), before: proposeKey, after: proposeKey });
      expect(proposeRow?.evidence, route).toMatch(new RegExp(`^Shop management key, propose mode: ${propose.replaceAll('+', '\\+')}; `, 'u'));
      expect(proposeRow?.evidence, route).toBe(`Shop management key, propose mode: ${propose}; ${proposeRow?.effect ?? ''}`);
      expect(row, route).toMatchObject(isAccessRoute
        ? { capability: propose.split(' + ')[0], before: proposeKey, after: proposeKey, evidence: proposeRow?.evidence }
        : { capability: direct.split(' + ')[0], before: directKey, after: directKey, evidence: directRow?.evidence });
    }
    expect(routes.get('POST /api/m2m/shop/products/access')?.modes?.propose.effect).toContain('stores a product.set-access proposal');
    for (const [route, operation] of [
      ['POST /api/m2m/shop/products/downloads', 'download.add'],
      ['POST /api/m2m/shop/products/downloads/replace', 'download.replace'],
      ['POST /api/m2m/shop/products/downloads/remove', 'download.remove'],
    ] as const) {
      expect(routes.get(route)?.modes?.propose.evidence, route).toContain(`stores a ${operation} proposal, which only an owner approval applies`);
    }
  });

  it('lists each key mode of the staging use-cases with the capabilities their guard authorizes', () => {
    const useCases = collectPermissionInventory().useCases.filter((row) => row.subject.startsWith('key-download-files.ts#'));
    expect(useCases.flatMap(({ subject, capability, after, modes }) => [
      [subject.replace('key-download-files.ts#', ''), capability, after],
      ...(modes === undefined ? [] : [modes.direct, modes.propose].map((mode) => [mode.principal, mode.capability, mode.after, mode.evidence.replace(/^.* mode: /u, '')])),
    ])).toEqual(
      ['beginKeyDownloadUpload', 'completeKeyDownloadUpload', 'copyKeyDownloadFile', 'listKeyDownloadFiles', 'discardKeyDownloadFile'].flatMap((name) => {
        const read = name === 'copyKeyDownloadFile' ? ' + product:read' : '';
        return [
          [name, 'product:write', [SHOP_MANAGEMENT_KEY_PRINCIPAL]],
          [SHOP_MANAGEMENT_KEY_PRINCIPAL, 'product:write', [SHOP_MANAGEMENT_KEY_PRINCIPAL], `product:write${read}`],
          [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL, 'proposal:asset:upload', [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL], `proposal:asset:upload + proposal:submit:catalog${read}`],
        ];
      }),
    );
    for (const row of useCases) {
      expect(row.modes?.direct.capabilities.join(' + '), row.subject).toBe(row.modes?.direct.evidence.replace(/^.* mode: /u, ''));
      expect(row.modes?.propose.capabilities.join(' + '), row.subject).toBe(row.modes?.propose.evidence.replace(/^.* mode: /u, ''));
    }
  });

  it('gives the link to a proposed download file to the owner only', () => {
    const useCases = collectPermissionInventory().useCases.filter((row) => row.subject.startsWith('change-proposal-files.ts#'));
    expect(useCases.map(({ subject, capability, after }) => [subject.replace('change-proposal-files.ts#', ''), capability, after])).toEqual([
      ['getChangeProposalFileLink', 'proposal:read', ['owner']],
    ]);
  });

  it('machine-checks every derivable before and after principal set', () => {
    const inventory = collectPermissionInventory();
    const rows = [...inventory.routes, ...inventory.useCases];
    const changes = rows
      .filter((row) => row.derivable)
      .filter((row) => row.before.join(',') !== row.after.join(','));
    expect(changes).toEqual([]);
    const modeChanges = rows
      .filter((row) => row.derivable)
      .flatMap((row) => row.modes === undefined ? [] : [row.modes.direct, row.modes.propose].map((mode) => ({ subject: row.subject, mode })))
      .filter(({ mode }) => mode.before.join(',') !== mode.after.join(','));
    expect(modeChanges).toEqual([]);
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

  const keyModeInventory = (proposeAfter: readonly (typeof SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL)[]): PermissionInventory => ({
    routes: [{
      subject: 'POST /probe',
      capability: 'product:write',
      before: [SHOP_MANAGEMENT_KEY_PRINCIPAL],
      after: [SHOP_MANAGEMENT_KEY_PRINCIPAL],
      derivable: true,
      evidence: 'probe, direct mode: product:write',
      modes: {
        direct: {
          principal: SHOP_MANAGEMENT_KEY_PRINCIPAL, capability: 'product:write', capabilities: ['product:write'],
          before: [SHOP_MANAGEMENT_KEY_PRINCIPAL], after: [SHOP_MANAGEMENT_KEY_PRINCIPAL], evidence: 'probe, direct mode: product:write',
        },
        propose: {
          principal: SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL, capability: 'proposal:submit:catalog', capabilities: ['proposal:submit:catalog'],
          before: [SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL], after: proposeAfter, evidence: 'probe, propose mode: proposal:submit:catalog',
        },
      },
    }],
    useCases: [],
    sourceEvidence: [],
    suspicious: [],
  });

  it('renders a row with key modes as one table line per mode', () => {
    const table = renderPermissionTable(keyModeInventory([SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL])).split('\n');
    expect(table.filter((line) => line.startsWith('| `POST /probe'))).toEqual([
      `| \`POST /probe (direct-mode key)\` | product:write | ${SHOP_MANAGEMENT_KEY_PRINCIPAL} | ${SHOP_MANAGEMENT_KEY_PRINCIPAL} | yes | probe, direct mode: product:write |`,
      `| \`POST /probe (propose-mode key)\` | proposal:submit:catalog | ${SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL} | ${SHOP_MANAGEMENT_PROPOSE_KEY_PRINCIPAL} | yes | probe, propose mode: proposal:submit:catalog |`,
    ]);
    expect(table.find((line) => line.startsWith('Closed capability count: '))).toMatch(/ Route rows: 2\. Exported `Ctx` use-case rows: 0\.$/u);
  });

  it('refuses a key mode whose principals change even when the row itself does not', () => {
    expect(() => renderPermissionTable(keyModeInventory([]))).toThrow('Permission changes detected: POST /probe (propose-mode key)');
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

  const STAGING_KEY = `
    const stagingKey = (ctx: Ctx) => {
      const actor = ctx.machineActor;
      if (actor === undefined) return err(forbidden('Keys only'));
      return actor.mode === 'direct'
        ? authorizeTenant(ctx, 'product:write')
        : bothAuthorized(authorizeTenant(ctx, 'proposal:asset:upload'), authorizeTenant(ctx, 'proposal:submit:catalog'));
    };
  `;
  const STAGING_USE_CASE = `
    export const stageThing = async (ctx: Ctx) => stagingKey(ctx);
  `;

  it('reads both mode branches of the staging guard it resolves in the same file', () => {
    expect(collectUseCasesInSource('probe.ts', `${STAGING_KEY}${STAGING_USE_CASE}`)).toEqual([{
      name: 'stageThing', file: 'probe.ts', capability: 'product:write',
      keyModes: { direct: ['product:write'], propose: ['proposal:asset:upload', 'proposal:submit:catalog'] },
    }]);
  });

  it.each([
    ['declared in another file', STAGING_USE_CASE],
    ['missing its propose-mode guard', `${STAGING_KEY.replace("bothAuthorized(authorizeTenant(ctx, 'proposal:asset:upload'), authorizeTenant(ctx, 'proposal:submit:catalog'))", "authorizeTenant(ctx, 'proposal:asset:upload')")}${STAGING_USE_CASE}`],
    ['missing its direct-mode guard', `${STAGING_KEY.replace("authorizeTenant(ctx, 'product:write')", 'ok(ctx.identity.tenantId)')}${STAGING_USE_CASE}`],
    ['an unrelated helper of the same name', `const stagingKey = (ctx: Ctx) => ok(ctx.identity.tenantId);${STAGING_USE_CASE}`],
    ['branching on something other than the key mode', `${STAGING_KEY.replace("actor.mode === 'direct'", "actor.kind === 'direct'")}${STAGING_USE_CASE}`],
  ])('refuses a staging guard %s', (_label, source) => {
    expect(() => collectUseCasesInSource('probe.ts', source)).toThrow(/stagingKey/u);
  });

  it.each([
    ['ProductCover', 'proposal:submit:catalog', 'proposal:submit:settings'],
    ['BrandingAsset', 'proposal:submit:settings', 'proposal:submit:catalog'],
  ])('binds the %s proposal upload to its own submission capability', (family, own, other) => {
    const source = (capability: string) => `
      export const beginProposed${family}Upload = (ctx: Ctx) =>
        bothAuthorized(authorizeTenant(ctx, 'proposal:asset:upload'), authorizeTenant(ctx, '${capability}'));
    `;
    expect(collectUseCasesInSource('change-proposal-images.ts', source(own))).toEqual([
      { name: `beginProposed${family}Upload`, file: 'change-proposal-images.ts', capability: 'proposal:asset:upload' },
    ]);
    expect(() => collectUseCasesInSource('change-proposal-images.ts', source(other))).toThrow(`must authorize proposal:asset:upload + ${own}; found proposal:asset:upload, ${other}`);
  });

  it.each([
    ['ProductCover', 'proposal:asset:upload'],
    ['ProductCover', 'proposal:submit:catalog'],
    ['BrandingAsset', 'proposal:asset:upload'],
    ['BrandingAsset', 'proposal:submit:settings'],
  ])('refuses the %s proposal upload that authorizes only %s', (family, capability) => {
    const source = `
      export const completeProposed${family}Upload = (ctx: Ctx) => authorizeTenant(ctx, '${capability}');
    `;
    expect(() => collectUseCasesInSource('change-proposal-images.ts', source)).toThrow(/must authorize proposal:asset:upload/u);
  });

  it('classifies organization use-cases by the capability given to authorizeOrganization', () => {
    const source = `
      export const getOrganizationThing = async (octx: OrganizationCtx, input: { organizationId: string }) =>
        authorizeOrganization(octx, input.organizationId, 'organization:read');
    `;
    expect(collectUseCasesInSource('probe.ts', source)).toEqual([
      { name: 'getOrganizationThing', file: 'probe.ts', capability: 'organization:read', organizationContext: true },
    ]);
  });

  it('keeps organization rows on organization principals only', () => {
    const inventory = collectPermissionInventory();
    const rows = [...inventory.routes, ...inventory.useCases].filter((row) => row.capability?.startsWith('organization:') === true);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const row of rows) {
      expect(row.after.every((principal) => principal.startsWith('organization-')), row.subject).toBe(true);
      expect(row.after, row.subject).toEqual(row.before);
    }
  });
});

