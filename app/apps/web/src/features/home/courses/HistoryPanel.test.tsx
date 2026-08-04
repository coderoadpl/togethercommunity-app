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
        expect(url.searchParams.get('courseId')).toBe('course-1');
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
                createdBy: 'user-creator',
                createdByDisplayName: 'Ada Creator',
                subjectKind: 'course',
                subjectName: 'Course one',
              },
              {
                id: 'version-2',
                entityKind: 'course_module',
                entityId: 'module-1',
                schemaVersion: 1,
                createdAt: '2026-01-02T00:00:00.000Z',
                createdBy: 'user-creator',
                createdByDisplayName: 'Ada Creator',
                subjectKind: 'module',
                subjectName: 'Foundations',
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
      await screen.findAllByText((content) => content.includes('Schemat v1') && content.includes('Ada Creator')),
    ).toHaveLength(2);
    expect(screen.getByText((content) => content.includes('Kurs: Course one') && content.includes('version-1'))).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('Moduł: Foundations') && content.includes('version-2'))).toBeInTheDocument();
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
