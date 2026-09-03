import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { pl } from '../../../i18n/pl.js';
import { formatDateTime } from '../../../lib/format.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { ReportsPanel } from './ReportsPanel.js';

describe('ReportsPanel', () => {
  it('renders localized report reasons', async () => {
    server.use(
      http.get('/api/reports', () =>
        HttpResponse.json({
          ok: true,
          data: {
            items: [{
              report: {
                id: 'report-1',
                tenantId: 'tenant-1',
                postId: 'post-1',
                reporterUserId: 'member-user',
                reporterDisplay: 'Member One',
                source: 'member',
                reason: 'off-topic',
                note: null,
                signals: null,
                status: 'open',
                createdAt: '2026-07-29T00:00:00.000Z',
                resolvedAt: null,
                resolvedByUserId: null,
              },
              post: {
                id: 'post-1',
                tenantId: 'tenant-1',
                contextKind: 'space',
                contextId: 'space-1',
                parentPostId: null,
                rootPostId: 'post-1',
                authorDisplay: 'Author',
                authorIsStaff: false,
                body: 'Post body',
                createdAt: '2026-07-29T00:00:00.000Z',
                editedAt: null,
                deletedAt: null,
                pinnedAt: null,
                isOwn: false,
              },
              spaceName: 'General',
              openReportsForPost: 1,
            }],
            nextCursor: null,
            openCount: 1,
          },
        })),
    );

    renderWithProviders(<ReportsPanel />);

    expect(await screen.findByText(pl.community.reportReasonOffTopic)).toBeInTheDocument();
    expect(screen.queryByText('off-topic')).not.toBeInTheDocument();
  });

  it('lists reported conversations with their snapshot and resolves them', async () => {
    let resolveBody: unknown;
    server.use(
      http.get('/api/reports', () =>
        HttpResponse.json({ ok: true, data: { items: [], nextCursor: null, openCount: 0 } })),
      http.get('/api/dm-reports', () =>
        HttpResponse.json({
          ok: true,
          data: {
            reports: [{
              id: 'dm-report-1',
              tenantId: 'tenant-1',
              conversationId: 'conversation-1',
              reporterUserId: 'member-user',
              reporterDisplay: 'Member One',
              reportedUserId: 'other-user',
              reportedDisplay: 'Other Person',
              reason: 'harassment',
              snapshot: [{
                id: 'dm-1',
                senderDisplay: 'Other Person',
                senderIsReporter: false,
                body: 'Nieprzyjemna wiadomość',
                createdAt: '2026-07-29T00:00:00.000Z',
              }],
              status: 'open',
              createdAt: '2026-07-29T00:00:00.000Z',
              resolvedAt: null,
              resolvedByUserId: null,
            }],
            nextCursor: null,
            openCount: 1,
          },
        })),
      http.post('/api/dm-reports/resolve', async ({ request }) => {
        resolveBody = await request.json();
        return HttpResponse.json({ ok: true, data: { report: { id: 'dm-report-1' } } });
      }),
    );

    renderWithProviders(<ReportsPanel />);

    expect(await screen.findByTestId('dm-report-row')).toBeInTheDocument();
    expect(screen.getByTestId('dm-report-snapshot-dm-report-1')).toHaveTextContent(
      'Nieprzyjemna wiadomość',
    );
    expect(screen.getByTestId('dm-report-snapshot-dm-report-1')).toHaveTextContent(
      formatDateTime('2026-07-29T00:00:00.000Z', 'pl'),
    );
    expect(
      screen.getByText(
        pl.dmReports.parties({ reporter: 'Member One', reported: 'Other Person' }),
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('dm-report-resolve-dm-report-1'));
    await userEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(resolveBody).toEqual({ reportId: 'dm-report-1' }));
  });

  it('reaches older reported conversations through a larger page', async () => {
    const dmReport = (id: string) => ({
      id,
      tenantId: 'tenant-1',
      conversationId: `conversation-${id}`,
      reporterUserId: 'member-user',
      reporterDisplay: 'Member One',
      reportedUserId: 'other-user',
      reportedDisplay: 'Other Person',
      reason: 'harassment',
      snapshot: [],
      status: 'open',
      createdAt: '2026-07-29T00:00:00.000Z',
      resolvedAt: null,
      resolvedByUserId: null,
    });
    const requestedLimits: Array<string | null> = [];
    server.use(
      http.get('/api/reports', () =>
        HttpResponse.json({ ok: true, data: { items: [], nextCursor: null, openCount: 0 } })),
      http.get('/api/dm-reports', ({ request }) => {
        const limit = new URL(request.url).searchParams.get('limit');
        requestedLimits.push(limit);
        const paged = limit === '20';
        return HttpResponse.json({
          ok: true,
          data: {
            reports: paged ? [dmReport('dm-report-1')] : [dmReport('dm-report-1'), dmReport('dm-report-2')],
            nextCursor: paged ? 'cursor-1' : null,
            openCount: 2,
          },
        });
      }),
    );

    renderWithProviders(<ReportsPanel />);

    await userEvent.click(await screen.findByTestId('dm-reports-load-more'));

    await waitFor(() => expect(screen.getAllByTestId('dm-report-row')).toHaveLength(2));
    expect(requestedLimits).toEqual(['20', '40']);
    expect(screen.queryByTestId('dm-reports-load-more')).not.toBeInTheDocument();
  });
});
