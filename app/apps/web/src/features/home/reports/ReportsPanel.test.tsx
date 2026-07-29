import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { pl } from '../../../i18n/pl.js';
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
});
