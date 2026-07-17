import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { HistoryPanel } from './HistoryPanel.js';

describe('HistoryPanel', () => {
  it('renders the read-only note and a version list scoped to the course', async () => {
    server.use(
      http.get('/api/courses/history', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('entityKind')).toBe('course');
        expect(url.searchParams.get('entityId')).toBe('course-1');
        return HttpResponse.json({
          ok: true,
          data: {
            versions: [
              {
                id: 'version-1',
                entityKind: 'course',
                entityId: 'course-1',
                schemaVersion: 1,
                createdAt: '2026-01-01T00:00:00.000Z',
                createdBy: 'creator@together.dev',
              },
            ],
          },
        });
      }),
    );

    renderWithProviders(<HistoryPanel courseId="course-1" />);

    expect(await screen.findByText(pl.courses.historyHeading)).toBeInTheDocument();
    expect(screen.getByText(pl.courses.historyRestoreNote)).toBeInTheDocument();
    expect(
      await screen.findByText((content) => content.includes('schemat v1') && content.includes('creator@together.dev')),
    ).toBeInTheDocument();
    expect(screen.getByText(pl.courses.historyEntryId({ id: 'version-1' }))).toBeInTheDocument();
  });

  it('shows the empty state when a course has no snapshots yet', async () => {
    server.use(
      http.get('/api/courses/history', () =>
        HttpResponse.json({ ok: true, data: { versions: [] } }),
      ),
    );

    renderWithProviders(<HistoryPanel courseId="course-2" />);

    expect(await screen.findByText(pl.courses.historyEmpty)).toBeInTheDocument();
  });
});
