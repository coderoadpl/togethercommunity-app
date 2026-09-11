import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { Campaign, CampaignEngagementStats, CampaignResults } from '#core/domain/index.js';
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
  results: CampaignResults;
};

const campaignRow = (overrides: Partial<CampaignRow> = {}): CampaignRow => ({
  ...campaign(overrides),
  engagement: { uniqueOpens: 0, totalOpens: 0, uniqueClicks: 0, totalClicks: 0 },
  queued: 0,
  unresolved: 0,
  results: { candidates: 0, waiting: 0, sent: 0, failed: 0, skipped: 0, delivered: 0, bounced: 0, complained: 0, unresolved: 0 },
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

const listsHandler = () =>
  http.get('/api/marketing/lists', () => HttpResponse.json({ ok: true, data: { lists: [], nextCursor: null } }));

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
                candidateCount: 5_000,
                skipped: 2,
                results: { candidates: 12, waiting: 5, sent: 4, failed: 1, skipped: 2, delivered: 3, bounced: 1, complained: 0, unresolved: 0 },
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
                results: { candidates: 7, waiting: 2, sent: 3, failed: 1, skipped: 1, delivered: 2, bounced: 0, complained: 0, unresolved: 1 },
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
    expect(await screen.findByText('sent 4/5000')).toBeInTheDocument();
    expect(screen.getByText('sent 3/7')).toBeInTheDocument();
    expect(screen.getByText('delivered 3 · bounces 1 · complaints 0')).toBeInTheDocument();
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
              candidateCount: 5_000,
              unresolved: 2,
              results: { candidates: 8, waiting: 2, sent: 4, failed: 1, skipped: 1, delivered: 3, bounced: 1, complained: 0, unresolved: 0 },
              engagement: { uniqueOpens: 6, totalOpens: 10, uniqueClicks: 2, totalClicks: 3 },
            }),
          },
        })),
      consentDefinitionsHandler(),
      productsHandler(),
      layoutsHandler(),
      listsHandler(),
      settingsHandler(),
      http.get('/api/marketing/scheduler-runs', () => HttpResponse.json({ ok: true, data: { items: [], summary: { runsLast24Hours: 0, sentLast24Hours: 0, failedLast24Hours: 0, lastRun: null }, nextCursor: null } })),
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
    expect(screen.getByText('75% of sent')).toBeInTheDocument();
    expect(screen.getByText('25% of sent')).toBeInTheDocument();
    expect(screen.getByText('5000 contacts · sent 4 · waiting 2 · skipped 1 · failed 1')).toBeInTheDocument();
    expect(screen.getByText(en.marketing.unresolvedAcceptance({ count: 2 }))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show message preview/ }).querySelector('svg')).not.toBeNull();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('routes drafts to the editor and finished campaigns to the report', async () => {
    let detail = campaignRow({ id: 'campaign-status-routing', name: 'Status routing', status: 'draft' });
    server.use(
      http.get('/api/marketing/campaigns/:campaignId', () => HttpResponse.json({ ok: true, data: { campaign: detail } })),
      consentDefinitionsHandler(),
      productsHandler(),
      layoutsHandler(),
      listsHandler(),
      settingsHandler(true),
      http.get('/api/marketing/scheduler-runs', () => HttpResponse.json({ ok: true, data: { items: [], summary: { runsLast24Hours: 0, sentLast24Hours: 0, failedLast24Hours: 0, lastRun: null }, nextCursor: null } })),
    );
    const root = createRootRoute();
    const route = createRoute({ getParentRoute: () => root, path: '/panel/marketing/campaigns/$campaignId', component: CampaignDetailPage });
    const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ['/panel/marketing/campaigns/campaign-status-routing'] }) });
    await router.load();
    const view = renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByLabelText(en.marketing.nameLabel)).toBeInTheDocument();
    expect(screen.queryByTestId('campaign-result-stats')).not.toBeInTheDocument();
    view.unmount();

    detail = campaignRow({
      id: 'campaign-status-routing', name: 'Status routing', status: 'finished',
      results: { candidates: 10, waiting: 0, sent: 8, failed: 1, skipped: 1, delivered: 6, bounced: 1, complained: 1, unresolved: 0 },
    });
    const secondRouter = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ['/panel/marketing/campaigns/campaign-status-routing'] }) });
    await secondRouter.load();
    renderWithProviders(<RouterProvider router={secondRouter} />);

    expect(await screen.findByTestId('campaign-result-stats')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.marketing.testSend })).not.toBeInTheDocument();
  });

  it('keeps the editor for scheduled version 1 campaigns and reports scheduled version 2 campaigns', async () => {
    let detail = campaignRow({ id: 'campaign-scheduled-routing', name: 'Scheduled routing', status: 'scheduled', audienceVersion: 1, sendAt: '2026-07-28T09:30:00.000Z' });
    server.use(
      http.get('/api/marketing/campaigns/:campaignId', () => HttpResponse.json({ ok: true, data: { campaign: detail } })),
      consentDefinitionsHandler(),
      productsHandler(),
      layoutsHandler(),
      listsHandler(),
      settingsHandler(true),
      http.get('/api/marketing/scheduler-runs', () => HttpResponse.json({ ok: true, data: { items: [], summary: { runsLast24Hours: 0, sentLast24Hours: 0, failedLast24Hours: 0, lastRun: null }, nextCursor: null } })),
    );
    const root = createRootRoute();
    const route = createRoute({ getParentRoute: () => root, path: '/panel/marketing/campaigns/$campaignId', component: CampaignDetailPage });
    const mount = async () => {
      const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ['/panel/marketing/campaigns/campaign-scheduled-routing'] }) });
      await router.load();
      return renderWithProviders(<RouterProvider router={router} />);
    };
    const view = await mount();

    expect(await screen.findByLabelText(en.marketing.nameLabel)).toBeEnabled();
    expect(screen.queryByText(en.marketing.lockedHint)).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-result-stats')).not.toBeInTheDocument();
    view.unmount();

    detail = campaignRow({ id: 'campaign-scheduled-routing', name: 'Scheduled routing', status: 'scheduled', audienceVersion: 2, sendAt: '2026-07-28T09:30:00.000Z' });
    await mount();

    expect(await screen.findByTestId('campaign-result-stats')).toBeInTheDocument();
    expect(screen.queryByLabelText(en.marketing.nameLabel)).not.toBeInTheDocument();
  });
  it('reports the version 1 product filter as a filter, not as an exclusion', async () => {
    const detail = campaignRow({ id: 'campaign-legacy-filter', name: 'Legacy filter', status: 'finished', audienceVersion: 1, audience: null, audienceFilter: { productIds: ['product-legacy'] }, sendAt: '2026-07-28T09:30:00.000Z' });
    server.use(
      http.get('/api/marketing/campaigns/:campaignId', () => HttpResponse.json({ ok: true, data: { campaign: detail } })),
      consentDefinitionsHandler(),
      productsHandler(),
      layoutsHandler(),
      listsHandler(),
      settingsHandler(true),
      http.get('/api/marketing/scheduler-runs', () => HttpResponse.json({ ok: true, data: { items: [], summary: { runsLast24Hours: 0, sentLast24Hours: 0, failedLast24Hours: 0, lastRun: null }, nextCursor: null } })),
    );
    const root = createRootRoute();
    const route = createRoute({ getParentRoute: () => root, path: '/panel/marketing/campaigns/$campaignId', component: CampaignDetailPage });
    const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ['/panel/marketing/campaigns/campaign-legacy-filter'] }) });
    await router.load();
    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByText(en.marketing.productFilterLabel)).toBeInTheDocument();
    expect(screen.getByText('product-legacy')).toBeInTheDocument();
    expect(screen.getByText(en.marketing.noExcludedProducts)).toBeInTheDocument();
  });
});
