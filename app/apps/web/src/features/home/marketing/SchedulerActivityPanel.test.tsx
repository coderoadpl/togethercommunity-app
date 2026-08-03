import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { SchedulerActivityDetailPage, SchedulerActivityPanel } from './SchedulerActivityPanel.js';

const run = {
  id: 'run-marketing-1',
  kind: 'marketing_tick',
  trigger: 'cron',
  startedAt: '2026-07-26T09:00:00.000Z',
  finishedAt: '2026-07-26T09:00:00.250Z',
  durationMs: 250,
  status: 'failed',
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
  batchSize: 6,
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
    server.use(http.get('/api/marketing/scheduler-runs', ({ request }) => {
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
    }));

    await renderRoute('/panel/marketing/activity');

    expect(await screen.findByText('18')).toBeInTheDocument();
    expect(screen.getByText(/wysłane: 3.*nieudane: 1.*pominięte: 2/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Szczegóły' })).toHaveAttribute(
      'href',
      '/panel/marketing/activity/run-marketing-1',
    );

    await userEvent.click(screen.getByLabelText('status'));
    await userEvent.click(screen.getByRole('option', { name: 'nieudane' }));

    expect(await screen.findByText('18')).toBeInTheDocument();
    expect(requests.some((request) => new URL(request).searchParams.get('status') === 'failed')).toBe(true);
  });

  it('shows the tenant breakdown, run failure, and a pre-filtered sends link', async () => {
    server.use(http.get('/api/marketing/scheduler-runs/:id', () =>
      HttpResponse.json({ ok: true, data: { run, tenant } })));

    await renderRoute('/panel/marketing/activity/run-marketing-1');

    expect(await screen.findByText('run-marketing-1')).toBeInTheDocument();
    expect(screen.getByText('quota service unavailable')).toBeInTheDocument();
    expect(screen.getByText('SES rejected recipient')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zobacz wysyłki z tego uruchomienia' })).toHaveAttribute(
      'href',
      '/panel/marketing/sends?runId=run-marketing-1',
    );
  });

  it('labels deleted evidence instead of send metrics for purge runs', async () => {
    server.use(
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
    expect(await screen.findByText('usunięte dowody zgody: 6')).toBeInTheDocument();
    list.unmount();

    await renderRoute('/panel/marketing/activity/run-purge-1');
    expect(await screen.findByText('Usunięte dowody zgody')).toBeInTheDocument();
    expect(screen.queryByText('Rozmiar partii')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Zobacz wysyłki z tego uruchomienia' })).not.toBeInTheDocument();
  });
});
