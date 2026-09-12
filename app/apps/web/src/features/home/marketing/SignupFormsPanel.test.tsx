import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { signupTestFixture } from './signup-test-data.js';
import { pl } from '../../../i18n/pl.js';
import { server } from '../../../test/server.js';
import { fixtureValue, installDirectoryFixture, renderDirectory } from './directory-test-helpers.js';
import { SignupFormsPanel } from './SignupFormsPanel.js';

const install = () => {
  installDirectoryFixture(signupTestFixture);
  server.use(http.get('/api/marketing/forms', () => HttpResponse.json({ ok: true, data: fixtureValue(signupTestFixture, 'listMarketingSignupForms') })));
};
describe('Studio signup forms', () => {
  it('shows counters and all three copyable embed paths', async () => {
    install();
    server.use(http.get('/api/tenant/routing', () => HttpResponse.json({ ok: true, data: fixtureValue(signupTestFixture, 'getTenantRouting') })));
    await renderDirectory(SignupFormsPanel, '/panel/marketing/forms');
    expect(await screen.findByText('Studio newsletter')).toBeInTheDocument();
    expect(screen.getByText('412')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Embed' }));
    expect(await screen.findByText('HTML form')).toBeInTheDocument();
    expect(screen.getByText(/<form method="post"/)).toHaveTextContent('name="token"');
    expect(screen.getByText(/fetch\(/)).toHaveTextContent('application/json');
  });
  it('edits with a revision and allows archiving without deleting history', async () => {
    install();
    let submitted: unknown;
    const detail = signupTestFixture.calls['listMarketingSignupForms:[{}]'].value.forms[0];
    if (detail === undefined) throw new Error('Missing form');
    server.use(http.post('/api/marketing/forms/newsletter', async ({ request }) => { submitted = await request.json(); return HttpResponse.json({ ok: true, data: { form: { ...detail.form, name: 'Updated newsletter', revision: 2 } } }); }));
    server.use(http.get('/api/tenant/routing', () => HttpResponse.json({ ok: true, data: fixtureValue(signupTestFixture, 'getTenantRouting') })));
    await renderDirectory(SignupFormsPanel, '/panel/marketing/forms');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit form' }));
    expect(screen.getByLabelText('Slug')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated newsletter' } });
    await userEvent.click(screen.getByRole('combobox', { name: 'Directory state' }));
    await userEvent.click(screen.getByRole('option', { name: 'Archived' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(submitted).toMatchObject({ slug: 'newsletter', expectedRevision: 1, name: 'Updated newsletter', status: 'archived' }));
  });
  it('provides bilingual success fields and validates HTTPS URLs', async () => {
    install();
    let created: unknown;
    const detail = signupTestFixture.calls['listMarketingSignupForms:[{}]'].value.forms[0];
    if (detail === undefined) throw new Error('Missing form');
    server.use(http.post('/api/marketing/forms', async ({ request }) => { created = await request.json(); return HttpResponse.json({ ok: true, data: { form: detail.form } }); }));
    await renderDirectory(SignupFormsPanel, '/panel/marketing/forms');
    await userEvent.click(screen.getByRole('button', { name: 'Create form' }));
    expect(screen.getByLabelText('Success message in English')).toBeRequired();
    expect(screen.getByLabelText('Success message in Polish')).toBeRequired();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Weekly news' } });
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'weekly-news' } });
    await userEvent.click(screen.getByRole('combobox', { name: 'Consent definition' }));
    await userEvent.click(await screen.findByRole('option', { name: /^newsletter/ }));
    fireEvent.change(screen.getByLabelText('Redirect URL (optional)'), { target: { value: 'http://example.org/welcome' } });
    fireEvent.change(screen.getByLabelText('Allowed JSON origins'), { target: { value: 'https://*.example.org' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Check the required fields, slug, URLs and tag limits.')).toBeInTheDocument();
    expect(created).toBeUndefined();
    fireEvent.change(screen.getByLabelText('Redirect URL (optional)'), { target: { value: 'https://example.org/welcome' } });
    fireEvent.change(screen.getByLabelText('Allowed JSON origins'), { target: { value: 'https://example.org' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(created).toMatchObject({ slug: 'weekly-news', redirectUrl: 'https://example.org/welcome', allowedOrigins: ['https://example.org'] }));
  });
  it('offers the visitor label language for the copied embed markup', async () => {
    install();
    server.use(http.get('/api/tenant/routing', () => HttpResponse.json({ ok: true, data: fixtureValue(signupTestFixture, 'getTenantRouting') })));
    await renderDirectory(SignupFormsPanel, '/panel/marketing/forms');
    await userEvent.click(await screen.findByRole('button', { name: 'Embed' }));
    expect(screen.getByText(/<form method="post"/)).toHaveTextContent('Email address');
    await userEvent.click(screen.getByRole('combobox', { name: 'Language of the visitor labels' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Polish' }));
    expect(screen.getByText(/<form method="post"/)).toHaveTextContent(pl.signupForms.email);
  });
});
