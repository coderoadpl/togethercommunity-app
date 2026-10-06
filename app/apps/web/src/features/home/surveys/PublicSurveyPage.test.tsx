import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { EMPTY_TENANT_BRANDING } from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { SurveyRoute } from './PublicSurveyPage.js';
import { sampleSurvey } from './survey-test-data.js';

const renderSurvey = async () => {
  server.use(http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: { contentVersion: 1, previewLessons: [], products: [], tenant: { slug: 'studio', name: 'Community', branding: EMPTY_TENANT_BRANDING, defaultLanguage: 'en', legal: { privacyUrl: null, termsUrl: null }, signInNotice: { enabled: false, text: '' }, socialLinks: [], support: { url: null } } } })));
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: '/survey/$slug', component: SurveyRoute });
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ['/survey/feedback'] }) });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};
describe('Public survey page', () => {
  it('submits without an account, carries the token and keeps only the sanitized ending afterward', async () => {
    let submitted: unknown;
    server.use(
      http.get('/api/public/surveys/feedback', () => HttpResponse.json({ ok: true, data: { survey: sampleSurvey } })),
      http.post('/api/public/surveys/feedback/submit', async ({ request }) => { submitted = await request.json(); return HttpResponse.json({ ok: true, data: { ending: '**Thank you** for sharing.', endingHtml: '<p><strong>Thank you</strong> for sharing.</p>' } }); }),
    );
    await renderSurvey();
    expect(await screen.findByText('Community')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Score 9' }));
    await userEvent.click(screen.getByRole('button', { name: en.surveys.submit }));
    expect(await screen.findByRole('status')).toHaveTextContent('Thank you for sharing.');
    expect(screen.queryByRole('button', { name: en.surveys.submit })).not.toBeInTheDocument();
    await waitFor(() => expect(submitted).toMatchObject({ score: 9, comment: '', website: '', token: sampleSurvey.token }));
  });
  it.each(['not-found', 'network'])('keeps the ending after a %s background refetch failure', async (failure) => {
    server.use(
      http.get('/api/public/surveys/feedback', () => HttpResponse.json({ ok: true, data: { survey: sampleSurvey } })),
      http.post('/api/public/surveys/feedback/submit', () => HttpResponse.json({ ok: true, data: { ending: 'Your response was received.', endingHtml: '<p>Your response was received.</p>' } })),
    );
    const { queryClient } = await renderSurvey();
    await userEvent.click(await screen.findByRole('button', { name: 'Score 9' }));
    await userEvent.click(screen.getByRole('button', { name: en.surveys.submit }));
    expect(await screen.findByRole('status')).toHaveTextContent('Your response was received.');
    server.use(http.get('/api/public/surveys/feedback', () => failure === 'not-found'
      ? HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'Survey not found' } }, { status: 404 })
      : HttpResponse.error()));
    const { queryKey } = actions.surveys.publicSurvey('feedback');
    await act(() => queryClient.refetchQueries({ queryKey }));
    await waitFor(() => expect(queryClient.getQueryState(queryKey)?.status).toBe('error'));
    expect(screen.getByRole('status')).toHaveTextContent('Your response was received.');
    expect(screen.queryByText(en.surveys.notFound)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.surveys.submit })).not.toBeInTheDocument();
  });
  it.each(['inactive', 'unknown'])('shows the branded not-found notice for an %s survey', async () => {
    server.use(http.get('/api/public/surveys/feedback', () => HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'Survey not found' } }, { status: 404 })));
    await renderSurvey();
    expect(await screen.findByText(en.surveys.notFound)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.surveys.submit })).not.toBeInTheDocument();
  });
  it('keeps the answer available when rate-limited', async () => {
    server.use(
      http.get('/api/public/surveys/feedback', () => HttpResponse.json({ ok: true, data: { survey: sampleSurvey } })),
      http.post('/api/public/surveys/feedback/submit', () => HttpResponse.json({ ok: false, error: { code: 'rate_limited', message: 'Please wait' } }, { status: 429 })),
    );
    await renderSurvey();
    await userEvent.click(await screen.findByRole('button', { name: 'Score 7' }));
    await userEvent.click(screen.getByRole('button', { name: en.surveys.submit }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.surveys.submit })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Score 7' })).toHaveAttribute('aria-pressed', 'true');
  });
});
