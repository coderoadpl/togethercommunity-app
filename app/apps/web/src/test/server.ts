import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import pkg from '../../../../package.json' with { type: 'json' };

export const server = setupServer(
  http.get('*/api/panel/list-layouts/:listId', () => HttpResponse.json({ ok: true, data: { layout: null } })),
  http.put('*/api/panel/list-layouts/:listId', async ({ request }) => HttpResponse.json({ ok: true, data: await request.json() })),
  http.delete('*/api/panel/list-layouts/:listId', () => HttpResponse.json({ ok: true, data: { reset: true } })),
  http.get('*/api/me/meta-capi/consents', () => HttpResponse.json({ ok: true, data: { consents: [] } })),
  http.get('*/api/tenant-secrets', () => HttpResponse.json({ ok: true, data: { secrets: [], stripeMode: null, stripeWebhookUrl: 'https://example.org/api/webhooks/stripe' } })),
  http.get('*/api/my/products', () =>
    HttpResponse.json({ ok: true, data: { products: [] } }),
  ),
  http.get('*/api/courses/history', () =>
    HttpResponse.json({ ok: true, data: { versions: [] } }),
  ),
  http.get('*/api/student/lessons/:lessonId/editions', () =>
    HttpResponse.json({ ok: true, data: { editions: [], currentEdition: null } }),
  ),
  http.get('*/api/change-proposals/summary', () =>
    HttpResponse.json({ ok: true, data: { pending: 0, pendingGroups: 0, hasProposals: false } }),
  ),
  http.get('*/api/messages/unread-count', () =>
    HttpResponse.json({ ok: true, data: { unread: 0 } }),
  ),
  http.get('*/api/member/navigation', () =>
    HttpResponse.json({ ok: true, data: { navigation: { spaces: [], courses: [], lockedSpaces: [] } } }),
  ),
  http.get('*/api/marketing/ses-onboarding/identities', () =>
    HttpResponse.json({ ok: true, data: { identities: [], accessDeniedAction: null } }),
  ),
  http.get('*/api/member/upcoming-events', () =>
    HttpResponse.json({ ok: true, data: { events: [] } }),
  ),
  http.get('*/api/spaces/:spaceId/events', () =>
    HttpResponse.json({ ok: true, data: { events: [], nextCursor: null } }),
  ),
  http.get('*/api/public/spaces/:spaceId/events', () =>
    HttpResponse.json({ ok: true, data: { events: [], nextCursor: null } }),
  ),
  http.get('*/api/integrations/shipx', () =>
    HttpResponse.json({ ok: true, data: {
      sender: null,
      sandbox: { organizationId: null, token: null, configured: false },
      production: { organizationId: null, token: null, configured: false },
    } }),
  ),
  http.get('*/api/orders/rejected-payments', () =>
    HttpResponse.json({ ok: true, data: { rejections: [] } }),
  ),
  http.get('*/api/orders/:orderId/shipx', () =>
    HttpResponse.json({ ok: true, data: { available: false, reason: 'not_inpost', environment: 'production', service: null, parcelTemplate: 'medium', shipment: null } }),
  ),
  http.post('*/api/orders/:orderId/shipx/refresh', () =>
    HttpResponse.json({ ok: true, data: { available: false, reason: 'not_inpost', environment: 'production', service: null, parcelTemplate: 'medium', shipment: null } }),
  ),
  http.get('*/api/public/parcel-lockers/:code', () =>
    HttpResponse.json({ ok: true, data: { status: 'unavailable' } }),
  ),
  http.get('*/api/public/payment-config', () =>
    HttpResponse.json({ ok: true, data: { stripeConfigured: false, simulatedPaymentsEnabled: false } }),
  ),
  http.get('*/api/health', () =>
    HttpResponse.json({
      ok: true,
      data: {
        status: 'ok',
        database: 'up',
        version: pkg.version,
        sha: 'unknown',
        environment: 'test',
        production: false,
        commit: null,
        databaseFingerprint: null,
        expectedMigrations: 82,
        appliedMigrations: 82,
        schemaCurrent: true,
        schemaFingerprint: 'c087b16a6bb6',
        schemaFingerprintMatch: true,
      },
    }),
  ),
);

export const anonymousMe = () =>
  http.get('*/api/me', () =>
    HttpResponse.json({ ok: false, error: { code: 'unauthorized', message: 'Sign in' } }, { status: 401 }));

export const memberMe = () =>
  http.get('*/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'u1',
        email: 'member@example.com',
        emailVerified: true,
        name: 'Member',
        tenant: {
          id: 't1',
          slug: 'acme',
          name: 'Acme',
          staffRole: null,
          memberId: 'm1',
          displayName: null,
          banned: false,
        },
        impersonation: null,
      },
    }));

export const staffMe = () =>
  http.get('*/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'u1',
        email: 'creator@together.dev',
        emailVerified: true,
        name: 'Demo',
        tenant: {
          id: 't1',
          slug: 'acme',
          name: 'Acme',
          staffRole: 'owner',
          memberId: null,
          displayName: null,
          banned: false,
        },
        impersonation: null,
      },
    }));

export const tenantlessMe = () =>
  http.get('*/api/me', () =>
    HttpResponse.json({
      ok: true,
      data: {
        userId: 'u1',
        email: 'member@example.com',
        emailVerified: true,
        name: 'Member',
        tenant: null,
        impersonation: null,
      },
    }));
