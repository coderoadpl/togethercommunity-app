import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { SchedulerActivityDetailPage, SchedulerActivityPanel } from './SchedulerActivityPanel.js';

const run = {
  id: 'run-marketing-1',
  kind: 'marketing_tick',
  trigger: 'cron',
  startedAt: '2026-07-26T09:00:00.000Z',
  finishedAt: '2026-07-26T09:00:01.250Z',
  durationMs: 1250,
  status: 'failed',
  idle: false,
  error: 'quota service unavailable',
  totals: {
    campaignsTouched: 2,
    sendsAttempted: 4,
    sent: 3,
    failed: 1,
    skipped: 2,
    reEnqueued: false,
  },
  createdAt: '2026-07-26T09:00:00.000Z',
} as const;

const tenant = {
  id: 'run-tenant-1',
  runId: run.id,
  tenantId: 'tenant-a',
  campaignsTouched: 1,
  batchSize: 6,
  sent: 3,
  failed: 1,
  skipped: 2,
  budgetComputed: 20,
  budgetUsed: 4,
  errors: ['SES rejected recipient'],
  createdAt: '2026-07-26T09:00:00.250Z',
};

const tenantWithoutRecordedErrors = {
  ...tenant,
  id: 'run-tenant-without-recorded-errors',
  errors: [],
};

const purgeRun = {
  ...run,
  id: 'run-purge-1',
  kind: 'consent_evidence_purge',
  status: 'completed',
  error: null,
  totals: {
    campaignsTouched: 0,
    sendsAttempted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    reEnqueued: false,
  },
} as const;

const purgeTenant = {
  ...tenant,
  id: 'run-tenant-purge-1',
  runId: purgeRun.id,
  campaignsTouched: 0,
  batchSize: 0,
  purged: 6,
  sent: 0,
  failed: 0,
  skipped: 0,
  budgetComputed: 0,
  budgetUsed: 0,
  errors: [],
};

const renderRoute = async (path: string) => {
  const root = createRootRoute();
  const activityRoute = createRoute({ getParentRoute: () => root, path: '/panel/marketing/activity', component: SchedulerActivityPanel });
  const detailRoute = createRoute({ getParentRoute: () => root, path: '/panel/marketing/activity/$runId', component: SchedulerActivityDetailPage });
  const router = createRouter({
    routeTree: root.addChildren([activityRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('scheduler activity panel', () => {
  it('shows tenant-only counts, summary, filters, and keyset pagination', async () => {
    const requests: string[] = [];
    server.use(
      http.get('/api/marketing/campaigns', () => HttpResponse.json({ ok: true, data: { campaigns: [] } })),
      http.get('/api/marketing/scheduler-runs', ({ request }) => {
      requests.push(request.url);
      const url = new URL(request.url);
      const filtered = url.searchParams.get('status') === 'failed';
      return HttpResponse.json({
        ok: true,
        data: {
          items: [{ run, tenant }],
          summary: {
            runsLast24Hours: 4,
            sentLast24Hours: 18,
            failedLast24Hours: 2,
            lastRun: run,
          },
          nextCursor: filtered ? null : 'next-page',
        },
      });
      }),
    );

    await renderRoute('/panel/marketing/activity');

    expect(await screen.findByText('18')).toBeInTheDocument();
    expect(screen.getByText(en.marketing.activity.counts(tenant))).toBeInTheDocument();
    expect(screen.getAllByText(new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(run.startedAt))).length).toBeGreaterThan(0);
    expect(screen.getByText('1.3 s')).toBeInTheDocument();
    const failedTile = screen.getByText(en.marketing.activity.failedLast24Hours).closest('a');
    if (failedTile === null) throw new Error('failed summary tile link was not rendered');
    expect(failedTile).toHaveAttribute('href', '/panel/marketing/sends?status=failed');
    expect(screen.getByRole('link', { name: en.marketing.activity.details })).toHaveAttribute(
      'href',
      '/panel/marketing/activity/run-marketing-1',
    );

    await userEvent.click(screen.getByLabelText('Status'));
    await userEvent.click(screen.getByRole('option', { name: en.marketing.activity.statuses.failed }));

    expect(await screen.findByText('18')).toBeInTheDocument();
    expect(requests.some((request) => new URL(request).searchParams.get('status') === 'failed')).toBe(true);
  });

  it('marks an idle run in the status cell', async () => {
    const idleRun = { ...run, status: 'completed' as const, idle: true, error: null };
    server.use(http.get('/api/marketing/scheduler-runs', () => HttpResponse.json({
      ok: true,
      data: {
        items: [{ run: idleRun, tenant: { ...tenant, sent: 0, failed: 0, skipped: 0, batchSize: 0 } }],
        summary: { runsLast24Hours: 1, sentLast24Hours: 0, failedLast24Hours: 0, lastRun: idleRun },
        nextCursor: null,
      },
    })));

    await renderRoute('/panel/marketing/activity');

    expect(await screen.findByText(en.marketing.activity.idle)).toBeInTheDocument();
  });

  it('shows the tenant breakdown, run failure, and a pre-filtered sends link', async () => {
    server.use(http.get('/api/marketing/scheduler-runs/:id', () =>
      HttpResponse.json({ ok: true, data: { run, tenant } })));

    await renderRoute('/panel/marketing/activity/run-marketing-1');

    expect(await screen.findByText('run-marketing-1')).toBeInTheDocument();
    expect(screen.getByText('quota service unavailable')).toBeInTheDocument();
    expect(screen.getByText('SES rejected recipient')).toBeInTheDocument();
    expect(screen.getByText(new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(run.finishedAt)))).toBeInTheDocument();
    expect(screen.getByText('1.3 s')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.marketing.activity.viewSends })).toHaveAttribute(
      'href',
      '/panel/marketing/sends?runId=run-marketing-1',
    );
  });

  it('links failed sends when a failed run has no recorded scheduler errors', async () => {
    server.use(http.get('/api/marketing/scheduler-runs/:id', () =>
      HttpResponse.json({ ok: true, data: { run, tenant: tenantWithoutRecordedErrors } })));

    await renderRoute('/panel/marketing/activity/run-marketing-1');

    expect(await screen.findByText(en.marketing.activity.failedWithoutRecordedErrors)).toBeInTheDocument();
    expect(screen.queryByText(en.marketing.activity.noErrors)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.marketing.activity.viewFailedSends })).toHaveAttribute(
      'href',
      '/panel/marketing/sends?runId=run-marketing-1&status=failed',
    );
  });

  it('shows a not-found empty state for missing run details without retry', async () => {
    server.use(http.get('/api/marketing/scheduler-runs/:id', () =>
      HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'Scheduler run was not found' } }, { status: 404 })));

    await renderRoute('/panel/marketing/activity/missing-run');

    expect(await screen.findByText(en.marketing.activity.detailTitle({ runId: 'missing-run' }))).toBeInTheDocument();
    expect(await screen.findByText(en.marketing.activity.runNotFoundTitle)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.marketing.activity.backToRuns })).toHaveAttribute(
      'href',
      '/panel/marketing/activity',
    );
    expect(screen.queryByRole('button', { name: en.common.retry })).not.toBeInTheDocument();
  });

  it('labels deleted evidence instead of send metrics for purge runs', async () => {
    server.use(
      http.get('/api/marketing/campaigns', () => HttpResponse.json({ ok: true, data: { campaigns: [] } })),
      http.get('/api/marketing/scheduler-runs', () => HttpResponse.json({
        ok: true,
        data: {
          items: [{ run: purgeRun, tenant: purgeTenant }],
          summary: { runsLast24Hours: 1, sentLast24Hours: 0, failedLast24Hours: 0, lastRun: purgeRun },
          nextCursor: null,
        },
      })),
      http.get('/api/marketing/scheduler-runs/:id', () =>
        HttpResponse.json({ ok: true, data: { run: purgeRun, tenant: purgeTenant } })),
    );

    const list = await renderRoute('/panel/marketing/activity');
    expect(await screen.findByText(en.marketing.activity.purgeCount({ purged: 6 }))).toBeInTheDocument();
    list.unmount();

    await renderRoute('/panel/marketing/activity/run-purge-1');
    expect(await screen.findByText(en.marketing.activity.evidencePurged)).toBeInTheDocument();
    expect(screen.queryByText(en.marketing.activity.batchSize)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: en.marketing.activity.viewSends })).not.toBeInTheDocument();
  });

  it('hides idle campaign ticks until the idle-run switch is enabled and uses the run-finished label', async () => {
    const idleRun = { ...purgeRun, id: 'run-idle-1', kind: 'marketing_tick' } as const;
    const idleTenant = { ...purgeTenant, id: 'run-tenant-idle-1', runId: idleRun.id, purged: undefined };
    const failedEmptyRun = { ...run, id: 'run-failed-empty', totals: { ...run.totals, sendsAttempted: 0, sent: 0, failed: 0, skipped: 0 } } as const;
    const failedEmptyTenant = { ...idleTenant, id: 'run-tenant-failed-empty', runId: failedEmptyRun.id, errors: ['SES credentials unavailable'] };
    server.use(
      http.get('/api/marketing/campaigns', () => HttpResponse.json({ ok: true, data: { campaigns: [] } })),
      http.get('/api/marketing/scheduler-runs', () => HttpResponse.json({
        ok: true,
        data: {
          items: [{ run: idleRun, tenant: idleTenant }, { run: failedEmptyRun, tenant: failedEmptyTenant }],
          summary: { runsLast24Hours: 1, sentLast24Hours: 0, failedLast24Hours: 0, lastRun: idleRun },
          nextCursor: null,
        },
      })),
    );

    await renderRoute('/panel/marketing/activity');

    expect(await screen.findByText('1')).toBeInTheDocument();
    expect(screen.getAllByTestId('scheduler-activity-row')).toHaveLength(1);
    expect(screen.getByText(en.marketing.activity.statuses.failed)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: en.marketing.activity.showIdleRuns }));
    expect(await screen.findAllByTestId('scheduler-activity-row')).toHaveLength(2);
    expect(screen.getAllByText(en.marketing.activity.statuses.completed).length).toBeGreaterThan(0);
  });

  it('shows scheduled campaigns with projected progress above the raw run table', async () => {
    server.use(
      http.get('/api/marketing/campaigns', () => HttpResponse.json({ ok: true, data: { campaigns: [{
        id: 'campaign-progress', tenantId: 'tenant-a', name: 'Autumn update', subject: 'Update', bodyHtml: '<p>Update</p>', bodySource: '<p>Update</p>', bodyText: null, replyTo: null,
        layoutId: null, consentDefinitionId: 'consent-1', audienceVersion: 2,
        audience: { version: 2, includeLists: [], excludeLists: [], excludeProductIds: [], includeMembersWithConsent: true },
        audienceSnapshotId: 'snapshot-1', snapshotMaxContactId: 'contact-5000', cursorContactId: 'contact-40', candidateCount: 5_000, skipped: 1,
        audienceFilter: null, status: 'scheduled', sendAt: '2026-07-27T12:00:00.000Z', snapshotMaxMemberId: null, cursorMemberId: null,
        toSend: 10, sent: 4, failed: 0, lockedUntil: null, lockedBy: null, errorCount: 0, pausedReason: null,
        audienceNameSnapshot: 'Newsletter', consentLabelSnapshot: 'Newsletter', startedAt: null, finishedAt: null, createdAt: '2026-07-27T10:00:00.000Z',
        engagement: { uniqueOpens: 0, totalOpens: 0, uniqueClicks: 0, totalClicks: 0 },
        queued: 0, unresolved: 0,
        results: { candidates: 40, waiting: 0, sent: 40, failed: 0, skipped: 0, delivered: 35, bounced: 3, complained: 2, unresolved: 0 },
      }] } })),
      http.get('/api/marketing/scheduler-runs', () => HttpResponse.json({ ok: true, data: { items: [], summary: { runsLast24Hours: 0, sentLast24Hours: 0, failedLast24Hours: 0, lastRun: null }, nextCursor: null } })),
    );

    await renderRoute('/panel/marketing/activity');

    expect(await screen.findByText(en.marketing.activity.campaignsInProgress)).toBeInTheDocument();
    expect(await screen.findByText('Autumn update')).toBeInTheDocument();
    expect(screen.getByText(en.marketing.activity.campaignProgress({ sent: 40, candidates: 5_000 }))).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: en.marketing.activity.campaignProgressLabel({ name: 'Autumn update' }) })).toHaveAttribute('aria-valuenow', '0.8');
    expect(screen.getByRole('link', { name: en.marketing.activity.openCampaignReport })).toHaveAttribute('href', '/panel/marketing/campaigns/campaign-progress');
  });
});
