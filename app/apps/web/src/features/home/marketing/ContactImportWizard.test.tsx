import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { MARKETING_IMPORT_ATTESTATION_TEXT, marketingDirectoryContracts } from '#core/client/index.js';
import { directoryTestFixtures } from './directory-test-data.js';
import { en } from '../../../i18n/en.js';
import { fixtureValue, installDirectoryFixture, renderDirectory } from './directory-test-helpers.js';
import { server } from '../../../test/server.js';
import { ContactImportWizard } from './ContactImportWizard.js';


const previewFixture = directoryTestFixtures['panel-marketing-contact-preview'];
const uploadFixture = directoryTestFixtures['panel-marketing-contact-import'];
const queuedFixture = directoryTestFixtures['panel-marketing-contact-queued'];

const preview = marketingDirectoryContracts.validateMarketingContactImport.output.parse(fixtureValue(previewFixture, 'validateMarketingContactImport'));
const queued = marketingDirectoryContracts.getMarketingContactImport.output.parse(fixtureValue(queuedFixture, 'getMarketingContactImport'));
const uploadFile = (content: string) => {
  const file = new File([content], 'contacts.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  fireEvent.change(screen.getByLabelText(en.directory.file), { target: { files: [file] } });
};

describe('contact import wizard', () => {
  it.each([
    ['contacts', 1, en.directory.commitContactsOne],
    ['contacts', 3, en.directory.commitContactsFew],
    ['contacts', 12, en.directory.commitContactsMany],
    ['suppressions', 1, en.directory.commitSuppressionsOne],
    ['suppressions', 3, en.directory.commitSuppressionsFew],
    ['suppressions', 12, en.directory.commitSuppressionsMany],
  ])('uses a complete localized commit label for %s with %s rows', async (kind, count, label) => {
    installDirectoryFixture(previewFixture);
    const batch = { ...preview.import, kind, rowCount: count, consentDefinitionId: null };
    server.use(http.get('/api/marketing/contact-imports/:id', () => HttpResponse.json({ ok: true, data: { import: batch } })), http.post('/api/marketing/contact-imports/:id/validate', () => HttpResponse.json({ ok: true, data: { ...preview, import: batch, canCommit: true, errors: [] } })));
    await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import', previewFixture.route);
    await waitFor(() => expect(screen.getByRole('button', { name: en.directory.next })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: en.directory.next }));
    expect(screen.getByRole('button', { name: label.replace('{count}', String(count)) })).toBeDisabled();
  });
  it('persists an uploaded draft URL and resumes every header after remapping and cancellation', async () => {
    installDirectoryFixture(previewFixture);
    server.use(http.post('/api/marketing/contact-imports/upload', () => HttpResponse.json({ ok: true, data: preview })), http.post('/api/marketing/contact-imports/:id/cancel', () => HttpResponse.json({ ok: true, data: { import: { ...preview.import, status: 'cancelled' } } })));
    const first = await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import');
    uploadFile('email,name,extra\nanna@example.org,Anna,Ignored');
    await userEvent.click(screen.getByRole('button', { name: en.directory.next }));
    await userEvent.click(screen.getByRole('button', { name: en.directory.validate }));
    await waitFor(() => expect(first.router.state.location.search).toMatchObject({ importId: preview.import.id }));
    const location = first.router.state.location.href;
    first.unmount();
    const resumed = await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import', location);
    await screen.findAllByText(/Invalid email/);
    expect(screen.getByRole('combobox', { name: 'extra' })).toHaveTextContent(en.directory.ignoreColumn);
    await userEvent.click(screen.getByRole('combobox', { name: 'name' }));
    await userEvent.click(screen.getByRole('option', { name: en.directory.ignoreColumn }));
    expect(screen.getByRole('combobox', { name: 'name' })).toHaveTextContent(en.directory.ignoreColumn);
    await userEvent.click(screen.getByRole('combobox', { name: 'name' }));
    await userEvent.click(screen.getByRole('option', { name: 'name' }));
    expect(screen.getByRole('combobox', { name: 'name' })).toHaveTextContent('name');
    server.use(http.get('/api/marketing/contact-imports/:id', () => HttpResponse.json({ ok: true, data: { import: { ...preview.import, status: 'cancelled' } } })));
    await userEvent.click(screen.getByRole('button', { name: en.directory.cancelImport }));
    expect(await screen.findByText(en.directory.cancelled)).toBeInTheDocument();
    resumed.unmount();
  });

  it('blocks skipping when the validation flag rejects conflicting consent evidence', async () => {
    installDirectoryFixture(previewFixture);
    server.use(http.post('/api/marketing/contact-imports/:id/validate', () => HttpResponse.json({ ok: true, data: { ...preview, canCommitWithSkippedRows: false, errors: [{ rowNumber: 3, message: 'Evidence conflict' }] } })));
    await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import', previewFixture.route);
    await screen.findByText(/Evidence conflict/);
    await userEvent.click(screen.getByRole('checkbox', { name: en.directory.skipInvalid }));
    expect(screen.getByRole('button', { name: en.directory.next })).toBeDisabled();
  });


  it('requires explicit delimiter for ambiguous CSV and allows custom column mapping before upload', async () => {
    installDirectoryFixture(uploadFixture);
    let metadata: string | undefined;
    server.use(http.post('/api/marketing/contact-imports/upload', async ({ request }) => { metadata = await request.text(); return HttpResponse.json({ ok: true, data: preview }); }));
    await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import');
    uploadFile('address;label,extra\nanna@example.org;Anna,Example');
    expect(await screen.findByText(en.directory.parseError)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.directory.next })).toBeDisabled();
    await userEvent.click(screen.getByRole('combobox', { name: en.directory.delimiter }));
    await userEvent.click(screen.getByRole('option', { name: en.directory.semicolon }));
    await userEvent.click(screen.getByRole('button', { name: en.directory.next }));
    expect(screen.getByRole('combobox', { name: 'address' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: 'address' }));
    await userEvent.click(screen.getByRole('option', { name: 'email' }));
    expect(screen.getByRole('combobox', { name: 'address' })).toHaveTextContent('email');
    await userEvent.click(screen.getByRole('button', { name: en.directory.validate }));
    await waitFor(() => expect(metadata).toContain('"address":"email"'));
    expect(metadata).toContain('"delimiter":";"');
  });

  it('requires explicit skipping, an unchecked legal checkbox and a note, then restores durable progress', async () => {
    installDirectoryFixture(previewFixture);
    let committed: unknown;
    server.use(http.post('/api/marketing/contact-imports/:id/commit', async ({ request }) => { committed = await request.json(); return HttpResponse.json({ ok: true, data: queued }, { status: 202 }); }), http.get('/api/marketing/contact-imports/:id', () => HttpResponse.json({ ok: true, data: committed ? queued : { import: preview.import } })));
    await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import', previewFixture.route);
    expect((await screen.findAllByText(/Invalid email/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: en.directory.next })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: en.directory.skipInvalid }));
    await userEvent.click(screen.getByRole('button', { name: en.directory.next }));
    const checkbox = screen.getByRole('checkbox', { name: MARKETING_IMPORT_ATTESTATION_TEXT });
    expect(checkbox).not.toBeChecked();
    const commit = screen.getByRole('button', { name: new RegExp(`^${en.directory.commit} 3`) });
    expect(commit).toBeDisabled();
    await userEvent.click(checkbox);
    fireEvent.change(screen.getByLabelText(en.directory.note), { target: { value: 'Permission evidence retained in the private archive.' } });
    await userEvent.click(commit);
    await waitFor(() => expect(committed).toMatchObject({ validationHash: preview.validationHash, invalidRows: 'skip_invalid', attestation: { accepted: true, locale: 'en' } }));
    expect(await screen.findByText(en.directory.queued)).toBeInTheDocument();
    expect(screen.getByText(en.directory.processingHint)).toBeInTheDocument();
  });

  it('invalidates preview and clears attestation after mapping changes', async () => {
    installDirectoryFixture(previewFixture);
    await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import', previewFixture.route);
    await screen.findAllByText(/Invalid email/);
    await userEvent.click(screen.getByRole('checkbox', { name: en.directory.skipInvalid }));
    await userEvent.click(screen.getByRole('button', { name: en.directory.next }));
    await userEvent.click(screen.getByRole('checkbox', { name: MARKETING_IMPORT_ATTESTATION_TEXT }));
    await userEvent.click(screen.getByRole('button', { name: en.directory.back }));
    await userEvent.click(screen.getByRole('combobox', { name: 'name' }));
    await userEvent.click(screen.getByRole('option', { name: en.directory.ignoreColumn }));
    expect(screen.getByText(en.directory.previewStale)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.directory.next })).toBeDisabled();
  });
});
