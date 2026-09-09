import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { TenantRedirect } from '#core/domain/index.js';

import { ToastProvider } from '../../../components/ui/Toast.js';
import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { RedirectsPanel } from './RedirectsPanel.js';

const COURSE_ID = 'course-js';
const LESSON_ID = 'lesson-intro';

const redirect = (overrides: Partial<TenantRedirect> = {}): TenantRedirect => ({
  id: 'redirect-1',
  tenantId: 'tenant-1',
  fromPath: '/legacy/one',
  targetKind: 'path',
  targetId: null,
  targetPath: '/my',
  permanent: true,
  origin: 'import',
  createdBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const page = (index: number) => redirect({
  id: `redirect-${String(index)}`,
  fromPath: `/legacy/${String(index).padStart(3, '0')}`,
});

interface Backend {
  created: unknown[];
  deleted: string[];
  queries: URLSearchParams[];
}

const installBackend = (seed: TenantRedirect[], createResult?: 'conflict'): Backend => {
  const backend: Backend = { created: [], deleted: [], queries: [] };
  let stored = [...seed];

  server.use(
    http.get('/api/courses', () => HttpResponse.json({
      ok: true,
      data: {
        courses: [{
          id: COURSE_ID,
          tenantId: 'tenant-1',
          name: 'Kurs JavaScript',
          description: '',
          imageUrl: null,
          moduleOrder: ['module-1'],
          publiclyVisible: false,
          legacyId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        }],
      },
    })),
    http.get('/api/modules', () => HttpResponse.json({
      ok: true,
      data: {
        modules: [{
          id: 'module-1',
          tenantId: 'tenant-1',
          courseIds: [COURSE_ID],
          title: 'Podstawy',
          prefix: null,
          name: 'Podstawy',
          chapters: [{
            id: 'chapter-1',
            name: 'Wstęp',
            contents: [{ id: 'content-1', name: 'Wstęp', lessonId: LESSON_ID }],
          }],
          legacyId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        }],
      },
    })),
    http.get('/api/lessons', () => HttpResponse.json({
      ok: true,
      data: {
        lessons: [{
          id: LESSON_ID,
          tenantId: 'tenant-1',
          name: 'Wstęp do JS',
          isPreview: false,
          contents: [],
          legacyId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        }],
      },
    })),
    http.get('/api/tenant/redirects', ({ request }) => {
      const params = new URL(request.url).searchParams;
      backend.queries.push(params);
      const search = params.get('search');
      const limit = Number(params.get('limit') ?? '50');
      const offset = Number(params.get('offset') ?? '0');
      const matching = search === null
        ? stored
        : stored.filter((entry) =>
            entry.fromPath.includes(search) || entry.targetPath.includes(search));
      return HttpResponse.json({
        ok: true,
        data: { redirects: matching.slice(offset, offset + limit), total: matching.length },
      });
    }),
    http.post('/api/tenant/redirects', async ({ request }) => {
      const body = await request.json();
      backend.created.push(body);
      if (createResult === 'conflict') {
        return HttpResponse.json(
          { ok: false, error: { code: 'conflict', message: 'taken' } },
          { status: 409 },
        );
      }
      const created = redirect({
        id: 'redirect-created',
        fromPath: '/course/javascript',
        origin: 'manual',
        permanent: z.object({ permanent: z.boolean() }).parse(body).permanent,
      });
      stored = [...stored, created];
      return HttpResponse.json({ ok: true, data: { redirect: created } });
    }),
    http.post('/api/tenant/redirects/remove', async ({ request }) => {
      const body = z.object({ id: z.string() }).parse(await request.json());
      backend.deleted.push(body.id);
      stored = stored.filter((entry) => entry.id !== body.id);
      return HttpResponse.json({ ok: true, data: { id: body.id } });
    }),
  );

  return backend;
};

const renderPage = () => {
  const rootRoute = createRootRoute();
  const redirectsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/settings/redirects',
    component: () => <RedirectsPanel />,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/panel/settings',
    component: () => <div data-testid="settings-route" />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([redirectsRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: ['/panel/settings/redirects'] }),
  });

  return renderWithProviders(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
};

const findToast = async (kind: 'success' | 'error') =>
  screen.findByTestId(new RegExp(`^toast-${kind}-`));

describe('RedirectsPanel', () => {
  it('lists redirects with their kind and origin', async () => {
    installBackend([
      redirect(),
      redirect({ id: 'redirect-2', fromPath: '/legacy/two', permanent: false, origin: 'manual' }),
    ]);

    renderPage();

    const first = await screen.findByTestId('redirect-row-redirect-1');
    expect(first).toHaveTextContent('/legacy/one');
    expect(within(first).getByText(pl.redirects.permanent)).toBeInTheDocument();
    expect(within(first).getByText(pl.redirects.originImport)).toBeInTheDocument();

    const second = screen.getByTestId('redirect-row-redirect-2');
    expect(within(second).getByText(pl.redirects.temporary)).toBeInTheDocument();
    expect(within(second).getByText(pl.redirects.originManual)).toBeInTheDocument();
  });

  it('shows the empty state when the workspace has no redirects', async () => {
    installBackend([]);

    renderPage();

    expect(await screen.findByText(pl.redirects.empty)).toBeInTheDocument();
  });

  it('keeps the add form collapsed until opened and closes it on cancel', async () => {
    installBackend([]);
    renderPage();

    const add = await screen.findByRole('button', { name: pl.redirects.addHeading });
    expect(screen.queryByTestId('redirect-add')).not.toBeInTheDocument();
    await userEvent.click(add);

    expect(screen.getByTestId('redirect-add')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: pl.redirects.permanentLabel })).not.toBeChecked();
    expect(screen.getByText(pl.redirects.permanentHint)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: pl.common.cancel }));

    expect(screen.queryByTestId('redirect-add')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: pl.redirects.addHeading })).toBeInTheDocument();
  });

  it('sends the search term to the server and reports no matches', async () => {
    const backend = installBackend([redirect()]);

    renderPage();
    await screen.findByTestId('redirect-row-redirect-1');
    await userEvent.type(screen.getByTestId('redirects-search'), 'nothing');

    expect(await screen.findByText(pl.redirects.noMatches)).toBeInTheDocument();
    await waitFor(() => {
      expect(backend.queries.some((query) => query.get('search') === 'nothing')).toBe(true);
    });
  });

  it('pages fifty rows at a time', async () => {
    const backend = installBackend(Array.from({ length: 60 }, (_, index) => page(index)));

    renderPage();
    await screen.findByTestId('redirect-row-redirect-0');
    expect(screen.queryByTestId('redirect-row-redirect-50')).not.toBeInTheDocument();
    expect(screen.getByTestId('redirects-total'))
      .toHaveTextContent(pl.tenantDomains.redirectsCount({ count: 60 }));

    await userEvent.click(screen.getByRole('button', { name: pl.pagination.nextPage }));

    expect(await screen.findByTestId('redirect-row-redirect-50')).toBeInTheDocument();
    expect(backend.queries.at(-1)?.get('offset')).toBe('50');
    expect(backend.queries.at(-1)?.get('limit')).toBe('50');
  });

  it('previews the normalised source path and creates a lesson redirect', async () => {
    const backend = installBackend([]);

    renderPage();
    await screen.findByText(pl.redirects.empty);
    await userEvent.click(screen.getByRole('button', { name: pl.redirects.addHeading }));

    await userEvent.type(screen.getByTestId('redirect-from-path'), '/Course/JavaScript/');
    expect(screen.getByTestId('redirect-from-path-preview'))
      .toHaveTextContent(pl.redirects.addSourcePreview({ path: '/course/javascript' }));

    await userEvent.click(screen.getByRole('radio', { name: pl.redirects.targetLesson }));
    await userEvent.click(await screen.findByLabelText(pl.redirects.targetCourseLabel));
    await userEvent.click(await screen.findByRole('option', { name: 'Kurs JavaScript' }));
    await userEvent.click(await screen.findByLabelText(pl.redirects.targetLessonLabel));
    await userEvent.click(await screen.findByRole('option', { name: 'Wstęp do JS' }));
    await userEvent.click(screen.getByTestId('redirect-permanent'));
    await userEvent.click(screen.getByRole('button', { name: pl.redirects.submit }));

    await waitFor(() => {
      expect(backend.created).toEqual([{
        fromPath: '/Course/JavaScript/',
        target: { kind: 'lesson', courseId: COURSE_ID, lessonId: LESSON_ID },
        permanent: true,
      }]);
    });
    expect(await findToast('success'))
      .toHaveTextContent(pl.redirects.created({ fromPath: '/course/javascript' }));
  });

  it('defaults to a temporary path redirect and collapses after refreshing the list', async () => {
    const backend = installBackend([]);

    renderPage();
    await screen.findByText(pl.redirects.empty);
    await userEvent.click(screen.getByRole('button', { name: pl.redirects.addHeading }));

    await userEvent.type(screen.getByTestId('redirect-from-path'), '/offer');
    await userEvent.click(screen.getByRole('radio', { name: pl.redirects.targetPath }));
    await userEvent.type(screen.getByTestId('redirect-target-path'), '/my');
    await userEvent.click(screen.getByRole('button', { name: pl.redirects.submit }));

    await waitFor(() => {
      expect(backend.created).toEqual([{
        fromPath: '/offer',
        target: { kind: 'path', path: '/my' },
        permanent: false,
      }]);
    });
    const row = await screen.findByTestId('redirect-row-redirect-created');
    expect(within(row).getByText(pl.redirects.temporary)).toBeInTheDocument();
    expect(screen.queryByTestId('redirect-add')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: pl.redirects.addHeading })).toBeInTheDocument();
  });

  it('reports a conflict from the server without clearing the form', async () => {
    installBackend([], 'conflict');

    renderPage();
    await screen.findByText(pl.redirects.empty);
    await userEvent.click(screen.getByRole('button', { name: pl.redirects.addHeading }));

    await userEvent.type(screen.getByTestId('redirect-from-path'), '/offer');
    await userEvent.click(screen.getByRole('radio', { name: pl.redirects.targetPath }));
    await userEvent.type(screen.getByTestId('redirect-target-path'), '/my');
    await userEvent.click(screen.getByRole('button', { name: pl.redirects.submit }));

    expect(await findToast('error')).toBeInTheDocument();
    expect(screen.getByTestId('redirect-from-path')).toHaveValue('/offer');
  });

  it('deletes a redirect only after the confirmation', async () => {
    const backend = installBackend([redirect()]);

    renderPage();
    await userEvent.click(await screen.findByTestId('redirect-delete-redirect-1'));
    expect(await screen.findByText(pl.redirects.deleteConfirmTitle)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(backend.deleted).toEqual([]);

    await userEvent.click(screen.getByTestId('redirect-delete-redirect-1'));
    await userEvent.click(await screen.findByTestId('redirect-delete-confirm'));

    await waitFor(() => { expect(backend.deleted).toEqual(['redirect-1']); });
    expect(await findToast('success')).toHaveTextContent(pl.redirects.deleted);
  });

  it('reports a failed deletion as a toast and keeps the confirmation open', async () => {
    installBackend([redirect()]);
    server.use(http.post('/api/tenant/redirects/remove', () =>
      HttpResponse.json({ ok: false, error: { code: 'internal' } }, { status: 500 })));

    renderPage();
    await userEvent.click(await screen.findByTestId('redirect-delete-redirect-1'));
    await userEvent.click(await screen.findByTestId('redirect-delete-confirm'));

    const dialog = await screen.findByRole('dialog');
    expect(await findToast('error')).toBeInTheDocument();
    expect(within(dialog).getByTestId('redirect-delete-confirm')).toBeEnabled();
  });

  it('stays on the current page when the deleted row was not the last one', async () => {
    const backend = installBackend(Array.from({ length: 120 }, (_, index) => page(index)));

    renderPage();
    await screen.findByTestId('redirect-row-redirect-0');
    await userEvent.click(screen.getByRole('button', { name: pl.pagination.nextPage }));
    await screen.findByTestId('redirect-row-redirect-50');
    await userEvent.click(screen.getByRole('button', { name: pl.pagination.nextPage }));

    await userEvent.click(await screen.findByTestId('redirect-delete-redirect-100'));
    await userEvent.click(await screen.findByTestId('redirect-delete-confirm'));

    await waitFor(() => { expect(backend.deleted).toEqual(['redirect-100']); });
    expect(await screen.findByTestId('redirect-row-redirect-101')).toBeInTheDocument();
    expect(backend.queries.at(-1)?.get('offset')).toBe('100');
  });

  it('returns to the first page after deleting the last row of the last page', async () => {
    const backend = installBackend(Array.from({ length: 51 }, (_, index) => page(index)));

    renderPage();
    await screen.findByTestId('redirect-row-redirect-0');
    await userEvent.click(screen.getByRole('button', { name: pl.pagination.nextPage }));

    await userEvent.click(await screen.findByTestId('redirect-delete-redirect-50'));
    await userEvent.click(await screen.findByTestId('redirect-delete-confirm'));

    await waitFor(() => { expect(backend.deleted).toEqual(['redirect-50']); });
    expect(await screen.findByTestId('redirect-row-redirect-0')).toBeInTheDocument();
    expect(screen.queryByText(pl.redirects.noMatches)).not.toBeInTheDocument();
  });

  it('shows the panel error when the list cannot be read', async () => {
    installBackend([]);
    server.use(http.get('/api/tenant/redirects', () =>
      HttpResponse.json({ ok: false, error: { code: 'internal' } }, { status: 500 })));

    renderPage();

    expect(await screen.findByRole('button', { name: pl.common.retry })).toBeInTheDocument();
  });
});
