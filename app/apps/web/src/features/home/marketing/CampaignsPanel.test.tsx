import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { CampaignActions, CampaignsPanel } from './CampaignsPanel.js';

const cancelledCampaign = {
  id: 'campaign-cancelled',
  tenantId: 'tenant-1',
  name: 'Cancelled',
  subject: 'Cancelled subject',
  bodyHtml: '<p>Cancelled</p>',
  bodySource: '# Cancelled',
  layoutId: null,
  consentDefinitionId: 'consent-1',
  audienceFilter: null,
  status: 'cancelled',
  sendAt: null,
  snapshotMaxMemberId: null,
  cursorMemberId: null,
  toSend: 0,
  sent: 0,
  failed: 0,
  lockedUntil: null,
  lockedBy: null,
  errorCount: 0,
  pausedReason: null,
  audienceNameSnapshot: null,
  consentLabelSnapshot: null,
  startedAt: null,
  finishedAt: null,
  createdAt: '2026-07-27T10:00:00.000Z',
} as const;

describe('campaign reputation warning', () => {
  it('surfaces a critical reputation banner on the campaign list', async () => {
    server.use(
      http.get('/api/marketing/campaigns', () =>
        HttpResponse.json({ ok: true, data: { campaigns: [] } })),
      http.get('/api/marketing/consent-definitions', () =>
        HttpResponse.json({ ok: true, data: { definitions: [] } })),
      http.get('/api/marketing/reputation', () =>
        HttpResponse.json({
          ok: true,
          data: {
            windowStart: '2026-07-20T12:00:00.000Z',
            windowEnd: '2026-07-27T12:00:00.000Z',
            hardBounce: { count: 10, sends: 100, rate: 0.1, status: 'critical' },
            complaint: { count: 0, sends: 100, rate: null, status: 'insufficient_data' },
            overallStatus: 'critical',
          },
        })),
    );
    const root = createRootRoute();
    const route = createRoute({
      getParentRoute: () => root,
      path: '/panel/marketing/campaigns',
      component: CampaignsPanel,
    });
    const router = createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({ initialEntries: ['/panel/marketing/campaigns'] }),
    });
    await router.load();

    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByText(/Reputacja wysyłki jest krytyczna/)).toBeInTheDocument();
  });

  it('shows terminal copy without test-send controls for a cancelled campaign', () => {
    renderWithProviders(<CampaignActions campaign={cancelledCampaign} />);

    expect(screen.getByText(/kampania została anulowana/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Wyślij test/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Przelicz odbiorców/i })).not.toBeInTheDocument();
  });
});
