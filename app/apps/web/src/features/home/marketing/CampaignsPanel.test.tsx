import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { Campaign, CampaignEngagementStats } from '#core/domain/index.js';
import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { CampaignActions, CampaignDetailPage, CampaignsPanel } from './CampaignsPanel.js';

const baseCampaign = {
  id: 'campaign-cancelled',
  tenantId: 'tenant-1',
  name: 'Cancelled',
  subject: 'Cancelled subject',
  bodyHtml: '<p>Cancelled</p>',
  bodyText: null, replyTo: null, bodySource: '# Cancelled',
  layoutId: null,
  consentDefinitionId: 'consent-1',
  audienceVersion: 1, audience: null, audienceSnapshotId: null, snapshotMaxContactId: null, cursorContactId: null, candidateCount: 0, skipped: 0,
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
} satisfies Campaign;

const campaign = (overrides: Partial<Campaign> = {}): Campaign => ({ ...baseCampaign, ...overrides });

type CampaignRow = Campaign & {
  engagement: CampaignEngagementStats;
  queued: number;
  unresolved: number;
};

const campaignRow = (overrides: Partial<CampaignRow> = {}): CampaignRow => ({
  ...campaign(overrides),
  engagement: { uniqueOpens: 0, totalOpens: 0, uniqueClicks: 0, totalClicks: 0 },
  queued: 0,
  unresolved: 0,
  ...overrides,
});

const now = '2026-07-27T10:00:00.000Z';

const sesSettings = (trackingEnabled: boolean) => ({
  tenantId: 'tenant-1',
  fromAddress: 'sender@example.com',
  replyTo: null,
  fromName: 'Sender',
  identity: 'example.com',
  identityVerifiedAt: now,
  identityCheckedAt: now,
  identityCheckError: null,
  configurationSet: 'configuration-set',
  snsTopicArn: 'arn:aws:sns:eu-central-1:123456789012:topic',
  snsSubscriptionEndpoint: 'https://example.com/api/webhooks/ses/webhook-token',
  snsSubscriptionConfirmedAt: now,
  trackingEnabled,
  autoPauseOnCritical: false,
  webhookToken: 'webhook_token_123456789012345',
  quotaRatePerSec: 10,
  quotaDaily: 50_000,
  quotaSentLast24Hours: 0,
  quotaRefreshedAt: now,
  inSandbox: false,
  webhookVerifiedAt: null,
  footerLegalName: 'Example Ltd',
  footerAddress: 'Street 1',
  broadcastsEnabled: true,
  reputationAlertStatus: null,
  reputationAlertedAt: null,
});

const settingsHandler = (trackingEnabled?: boolean) =>
  http.get('/api/marketing/ses-settings', () =>
    HttpResponse.json({
      ok: true,
      data: {
        settings: trackingEnabled === undefined ? null : sesSettings(trackingEnabled),
        credentialsConfigured: false,
        smtpConfigured: false,
        resendConfigured: false,
        platformPool: { used: 0, limit: 1000 },
        webhookUrl: null,
        webhookEndpointStale: false,
        lastSnsDelivery: null,
      },
    }));

const consentDefinitionsHandler = () =>
  http.get('/api/marketing/consent-definitions', () =>
    HttpResponse.json({
      ok: true,
      data: {
        definitions: [{
          id: 'consent-1',
          tenantId: 'tenant-1',
          key: 'product-news',
          kind: 'optional_marketing',
          channel: 'email',
          doubleOptIn: true,
          documentRef: { mode: 'url', url: 'https://example.com/privacy' },
          status: 'active',
          createdAt: '2026-07-20T10:00:00.000Z',
          updatedAt: '2026-07-20T10:00:00.000Z',
        }],
      },
    }));

const productsHandler = () =>
  http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products: [] } }));

const layoutsHandler = () =>
  http.get('/api/marketing/layouts', () => HttpResponse.json({ ok: true, data: { layouts: [] } }));

const reputationHandler = () =>
  http.get('/api/marketing/reputation', () =>
    HttpResponse.json({
      ok: true,
      data: {
        windowStart: '2026-07-20T12:00:00.000Z',
        windowEnd: '2026-07-27T12:00:00.000Z',
        hardBounce: { count: 0, sends: 0, rate: null, status: 'insufficient_data' },
        complaint: { count: 0, sends: 0, rate: null, status: 'insufficient_data' },
        overallStatus: 'insufficient_data',
      },
    }));

describe('campaign reputation warning', () => {
  it('surfaces a critical reputation banner on the campaign list', async () => {
    server.use(
      http.get('/api/marketing/campaigns', () =>
        HttpResponse.json({ ok: true, data: { campaigns: [] } })),
      http.get('/api/marketing/consent-definitions', () =>
        HttpResponse.json({ ok: true, data: { definitions: [] } })),
      settingsHandler(),
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

    expect(await screen.findByText(en.marketing.campaignReputationCriticalBanner)).toBeInTheDocument();
  });

  it('labels campaign dates, preserves stored engagement, and masks zero counters when tracking is disabled', async () => {
    server.use(
      http.get('/api/marketing/campaigns', () =>
        HttpResponse.json({
          ok: true,
          data: {
            campaigns: [
              campaignRow({
                id: 'campaign-scheduled',
                name: 'Scheduled campaign',
                status: 'scheduled',
                sendAt: '2026-07-28T09:30:00.000Z',
                audienceVersion: 2,
                candidateCount: 12,
                skipped: 2,
                queued: 5,
                unresolved: 1,
                engagement: { uniqueOpens: 3, totalOpens: 8, uniqueClicks: 1, totalClicks: 2 },
              }),
              campaignRow({
                id: 'campaign-draft',
                name: 'Draft campaign',
                status: 'draft',
                sendAt: null,
                createdAt: '2026-07-27T08:00:00.000Z',
                toSend: 7,
                sent: 3,
                failed: 1,
              }),
            ],
          },
        })),
      consentDefinitionsHandler(),
      settingsHandler(),
      reputationHandler(),
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

    expect(await screen.findByText(en.marketing.trackingDisabledCampaignMetrics)).toBeInTheDocument();
    expect(await screen.findByText('12 candidates · 2 skipped · 5 queued · 1 unresolved')).toBeInTheDocument();
    expect(screen.getByText('to send: 7 · sent: 3 · failed: 1')).toBeInTheDocument();
    expect(screen.getByText('Opens 3 unique · 8 total')).toBeInTheDocument();
    expect(screen.getByText('Clicks 1 unique · 2 total')).toBeInTheDocument();
    expect(await screen.findAllByText(en.marketing.compactOpensUnavailable)).toHaveLength(1);
    expect(screen.getByText((content) => content.startsWith('Send time:'))).toBeInTheDocument();
    expect(screen.getByText((content) => content.startsWith('Created:'))).toBeInTheDocument();
  });

  it('shows engagement totals when tracking is enabled', async () => {
    server.use(
      http.get('/api/marketing/campaigns', () =>
        HttpResponse.json({
          ok: true,
          data: {
            campaigns: [
              campaignRow({
                id: 'campaign-engaged',
                name: 'Engaged campaign',
                engagement: { uniqueOpens: 4, totalOpens: 9, uniqueClicks: 2, totalClicks: 5 },
              }),
            ],
          },
        })),
      consentDefinitionsHandler(),
      settingsHandler(true),
      reputationHandler(),
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

    expect(await screen.findByText('Opens 4 unique · 9 total')).toBeInTheDocument();
    expect(screen.getByText('Clicks 2 unique · 5 total')).toBeInTheDocument();
    expect(screen.queryByText(en.marketing.trackingDisabledCampaignMetrics)).not.toBeInTheDocument();
    expect(screen.queryByText(en.marketing.compactOpensUnavailable)).not.toBeInTheDocument();
  });

  it('shows terminal copy without test-send controls for a cancelled campaign', () => {
    renderWithProviders(<CampaignActions campaign={baseCampaign} />);

    expect(screen.getByText(en.marketing.cancelledCampaignHint)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.marketing.testSend })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.marketing.audiencePreview })).not.toBeInTheDocument();
  });

  it('shows scheduled status, local send time and worker pickup hint in the schedule card', () => {
    renderWithProviders(<CampaignActions campaign={campaign({
      id: 'campaign-scheduled',
      name: 'Scheduled',
      status: 'scheduled',
      sendAt: '2026-07-28T09:30:00.000Z',
    })} />);

    expect(screen.getByRole('heading', { name: en.marketing.scheduleCardTitle.scheduled })).toBeInTheDocument();
    expect(screen.getByText(en.marketing.status.scheduled)).toBeInTheDocument();
    expect(screen.getByText((content) => content.startsWith('Send time:') && content.includes(Intl.DateTimeFormat().resolvedOptions().timeZone))).toBeInTheDocument();
    expect(screen.getByText(en.marketing.workerPickupHint)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.marketing.cancelCampaign })).toBeInTheDocument();
  });

  it('shows the status chip in the campaign detail header', async () => {
    server.use(
      http.get('/api/marketing/campaigns/:campaignId', () =>
        HttpResponse.json({
          ok: true,
          data: {
            campaign: campaignRow({
              id: 'campaign-detail',
              name: 'Detail campaign',
              status: 'running',
              sent: 4,
              engagement: { uniqueOpens: 6, totalOpens: 10, uniqueClicks: 2, totalClicks: 3 },
            }),
          },
        })),
      consentDefinitionsHandler(),
      productsHandler(),
      layoutsHandler(),
      settingsHandler(),
    );
    const root = createRootRoute();
    const route = createRoute({
      getParentRoute: () => root,
      path: '/panel/marketing/campaigns/$campaignId',
      component: CampaignDetailPage,
    });
    const router = createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({ initialEntries: ['/panel/marketing/campaigns/campaign-detail'] }),
    });
    await router.load();

    renderWithProviders(<RouterProvider router={router} />);

    const heading = await screen.findByRole('heading', { name: /Detail campaign/ });
    expect(within(heading).getByText(en.marketing.status.running)).toBeInTheDocument();
    expect(screen.queryByText(en.marketing.trackingDisabledCampaignMetrics)).not.toBeInTheDocument();
    expect(within(screen.getByTestId('campaign-engagement-stats')).getByText('6')).toBeInTheDocument();
    expect(within(screen.getByTestId('campaign-engagement-stats')).getByText('10')).toBeInTheDocument();
    expect(within(screen.getByTestId('campaign-engagement-stats')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('campaign-engagement-stats')).getByText('3')).toBeInTheDocument();
    expect(screen.getByLabelText(en.marketing.layoutLabel)).toHaveTextContent(en.marketing.noLayout);
  });
});
