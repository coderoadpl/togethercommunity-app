import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_TENANT_BRANDING } from '#core/domain/index.js';
import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { renderDirectory } from '../marketing/directory-test-helpers.js';
import { SurveyList, SurveysPanel } from './SurveysPanel.js';
import { sampleResults, sampleSurvey } from './survey-test-data.js';

const install = () => {
  server.use(
    http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: { contentVersion: 1, previewLessons: [], products: [], tenant: { slug: 'studio', name: 'Community', branding: EMPTY_TENANT_BRANDING, defaultLanguage: 'en', legal: { privacyUrl: null, termsUrl: null }, signInNotice: { enabled: false, text: '' }, socialLinks: [], support: { url: null } } } })),
    http.get('/api/surveys', () => HttpResponse.json({ ok: true, data: { surveys: [sampleSurvey] } })),
    http.get('/api/surveys/survey-feedback/results', () => HttpResponse.json({ ok: true, data: { results: sampleResults } })),
    http.get('/api/tenant/routing', () => HttpResponse.json({ ok: true, data: { routing: { tenantHost: 'example.org', storageCorsOrigins: [], canonicalOrigin: 'https://example.org', customDomains: [], customDomainTarget: 'example.org', apexDomainsSupported: false, canAddCustomDomain: false } } })),
  );
};
describe('Studio surveys', () => {
  it.each([
    { label: en.surveys.edit, callback: 'onEdit' as const },
    { label: en.surveys.results, callback: 'onResults' as const },
    { label: en.surveys.deactivate, callback: 'onToggle' as const },
    { label: en.surveys.delete, callback: 'onDelete' as const },
  ])('runs $label for the selected survey from the mobile menu', async ({ label, callback }) => {
    const callbacks = { onEdit: vi.fn(), onResults: vi.fn(), onToggle: vi.fn(), onDelete: vi.fn() };
    renderWithProviders(<SurveyList surveys={[sampleSurvey]} {...callbacks} />);
    const button = screen.getByRole('button', { name: en.surveys.actions });
    await userEvent.click(button);
    await userEvent.click(await screen.findByRole('menuitem', { name: label }));
    expect(callbacks[callback]).toHaveBeenCalledExactlyOnceWith(sampleSurvey);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('shows results, copyable public URL and member-linked or anonymous responses', async () => {
    install();
    await renderDirectory(SurveysPanel, '/panel/marketing/surveys');
    expect(await screen.findByRole('columnheader', { name: en.surveys.status })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: en.surveys.actions })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: en.surveys.results }));
    expect(await screen.findByText('Alex Reader')).toHaveAttribute('href', '/panel/members/member-one');
    expect(screen.getByText(en.surveys.anonymous)).toBeInTheDocument();
    expect(screen.getByText(en.surveys.npsScore)).toBeInTheDocument();
    expect(screen.getByText(/\/survey\/feedback$/)).toBeInTheDocument();
  });
  it('sends only writable fields and the expected revision when deactivating', async () => {
    install();
    let input: unknown;
    server.use(http.post('/api/surveys/survey-feedback', async ({ request }) => { input = await request.json(); return HttpResponse.json({ ok: true, data: { survey: { ...sampleSurvey, active: false, revision: 2 } } }); }));
    await renderDirectory(SurveysPanel, '/panel/marketing/surveys');
    await userEvent.click(await screen.findByRole('button', { name: en.surveys.deactivate }));
    await waitFor(() => expect(input).toMatchObject({ active: false, expectedRevision: 1 }));
    expect(input).not.toHaveProperty('token');
    expect(input).not.toHaveProperty('tenantId');
  });
  it('requires confirmation before deleting responses with the survey', async () => {
    install();
    let removed = false;
    server.use(http.delete('/api/surveys/survey-feedback', () => { removed = true; return HttpResponse.json({ ok: true, data: { deleted: true } }); }));
    await renderDirectory(SurveysPanel, '/panel/marketing/surveys');
    await userEvent.click(await screen.findByRole('button', { name: en.surveys.delete }));
    expect(removed).toBe(false);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(en.surveys.deleteBody);
    await userEvent.click(within(dialog).getByRole('button', { name: en.surveys.delete }));
    await waitFor(() => expect(removed).toBe(true));
  });
  it('validates score ranges before saving and offers previews for every ending', async () => {
    install();
    let saves = 0;
    server.use(http.post('/api/surveys/survey-feedback', () => { saves++; return HttpResponse.json({ ok: true, data: { survey: sampleSurvey } }); }));
    await renderDirectory(SurveysPanel, '/panel/marketing/surveys');
    await userEvent.click(await screen.findByRole('button', { name: en.surveys.edit }));
    expect(screen.getAllByRole('button', { name: en.surveys.previewEnding })).toHaveLength(3);
    expect(screen.getByText(en.surveys.preview)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: `${en.surveys.ending} 1 · ${en.surveys.upperScore}` }), { target: { value: '9' } });
    await userEvent.click(screen.getByRole('button', { name: en.common.save }));
    expect(await screen.findByText(en.surveys.invalid)).toBeInTheDocument();
    expect(saves).toBe(0);
  });
  it('saves edited fields with all three ranges and previews Markdown through the shared renderer', async () => {
    install();
    let saved: unknown;
    let previewed: unknown;
    server.use(
      http.post('/api/surveys/survey-feedback', async ({ request }) => { saved = await request.json(); return HttpResponse.json({ ok: true, data: { survey: { ...sampleSurvey, title: 'Updated feedback', revision: 2 } } }); }),
      http.post('/api/surveys/preview', async ({ request }) => { previewed = await request.json(); return HttpResponse.json({ ok: true, data: { html: '<p>Rendered ending preview</p>' } }); }),
    );
    await renderDirectory(SurveysPanel, '/panel/marketing/surveys');
    await userEvent.click(await screen.findByRole('button', { name: en.surveys.edit }));
    const previews = screen.getAllByRole('button', { name: en.surveys.previewEnding });
    const firstPreview = previews[0];
    if (firstPreview === undefined) throw new Error('Missing ending preview');
    await userEvent.click(firstPreview);
    expect(await screen.findByText('Rendered ending preview')).toBeInTheDocument();
    expect(previewed).toEqual({ body: sampleSurvey.endings[0].body });
    fireEvent.change(screen.getByRole('textbox', { name: en.surveys.internalTitle }), { target: { value: 'Updated feedback' } });
    await userEvent.click(screen.getByRole('button', { name: en.common.save }));
    await waitFor(() => expect(saved).toMatchObject({ title: 'Updated feedback', expectedRevision: 1, endings: sampleSurvey.endings }));
    expect(await screen.findByText('Alex Reader')).toBeInTheDocument();
  });
  it('requests a new page without changing the aggregate result', async () => {
    install();
    const pages: string[] = [];
    server.use(http.get('/api/surveys/survey-feedback/results', ({ request }) => {
      const page = new URL(request.url).searchParams.get('page') ?? '1';
      pages.push(page);
      return HttpResponse.json({ ok: true, data: { results: { ...sampleResults, page: Number(page), totalPages: 2, responses: page === '1' ? sampleResults.responses.slice(0, 1) : sampleResults.responses.slice(1) } } });
    }));
    await renderDirectory(SurveysPanel, '/panel/marketing/surveys');
    await userEvent.click(await screen.findByRole('button', { name: en.surveys.results }));
    await userEvent.click(await screen.findByRole('button', { name: en.surveys.next }));
    expect(await screen.findByText(en.surveys.anonymous)).toBeInTheDocument();
    expect(pages).toEqual(['1', '2']);
    expect(screen.getByText('12')).toBeInTheDocument();
  });

});
