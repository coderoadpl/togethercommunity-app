import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { MARKETING_IMPORT_ATTESTATION_TEXT, marketingDirectoryContracts } from '#core/client/index.js';
import { MARKETING_IMPORT_EMAIL_INVALID, MARKETING_IMPORT_EMAIL_MISSING, marketingImportRowSchema } from '#core/domain/index.js';
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
const csvFile = (content: string | readonly number[], name = 'contacts.csv') => {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : Uint8Array.from(content);
  const file = new File([bytes], name, { type: 'text/csv' });
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(bytes.slice().buffer) });
  return file;
};
const uploadFile = (content: string) => {
  const file = csvFile(content);
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
    await userEvent.click(screen.getByRole('option', { name: en.directory.importFields.name }));
    expect(screen.getByRole('combobox', { name: 'name' })).toHaveTextContent(en.directory.importFields.name);
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
    const append = FormData.prototype.append;
    const appendSpy = vi.spyOn(FormData.prototype, 'append').mockImplementation(function (this: FormData, name, value, fileName) {
      if (name === 'metadata' && typeof value === 'string') metadata = value;
      if (fileName === undefined) return append.call(this, name, value);
      return append.call(this, name, value, fileName);
    });
    try {
      server.use(http.post('*/api/marketing/contact-imports/upload', () => HttpResponse.json({ ok: true, data: preview })));
      await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import');
      uploadFile('address;label,extra\nanna@example.org;Anna,Example');
      expect(await screen.findByText(en.directory.parseError)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: en.directory.next })).toBeDisabled();
      await userEvent.click(screen.getByRole('combobox', { name: en.directory.delimiter }));
      await userEvent.click(screen.getByRole('option', { name: en.directory.semicolon }));
      await userEvent.click(screen.getByRole('button', { name: en.directory.next }));
      expect(screen.getByRole('combobox', { name: 'address' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('combobox', { name: 'address' }));
      await userEvent.click(screen.getByRole('option', { name: en.directory.importFields.email }));
      expect(screen.getByRole('combobox', { name: 'address' })).toHaveTextContent(en.directory.importFields.email);
      await waitFor(() => expect(screen.getByRole('button', { name: en.directory.validate })).toBeEnabled());
      await userEvent.click(screen.getByRole('button', { name: en.directory.validate }));
      await waitFor(() => expect(metadata ?? '').toContain('"address":"email"'));
      expect(metadata).toContain('"delimiter":";"');
    } finally {
      appendSpy.mockRestore();
    }
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

  it('rejects malformed UTF-8 before parsing the CSV', async () => {
    installDirectoryFixture(uploadFixture);
    await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import');
    const input = screen.getByLabelText(en.directory.file);
    fireEvent.change(input, { target: { files: [csvFile([0xc3, 0x28])] } });
    expect(await screen.findByText(en.directory.encodingError)).toBeInTheDocument();
    expect(screen.queryByText('contacts.csv')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.directory.next })).toBeDisabled();
  });

  it('supports button selection, drag and drop, a filename chip and a sample download', async () => {
    installDirectoryFixture(uploadFixture);
    await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import');
    expect(screen.getByRole('button', { name: en.directory.chooseFile })).toBeInTheDocument();
    expect(screen.getByLabelText(en.directory.file)).not.toBeVisible();
    expect(screen.getByRole('link', { name: en.directory.downloadSample })).toHaveAttribute('download', 'contacts-import-sample.csv');
    const file = csvFile('email,name\nperson@example.org,Example Person', 'dropped.csv');
    fireEvent.drop(screen.getByRole('group', { name: en.directory.dropFile }), { dataTransfer: { files: [file] } });
    expect(await screen.findByText('dropped.csv')).toHaveClass('MuiChip-label');
    expect(screen.getByRole('button', { name: en.directory.next })).toBeEnabled();
    fireEvent.drop(screen.getByRole('group', { name: en.directory.dropFile }), { dataTransfer: { files: [] } });
    expect(screen.getByText('dropped.csv')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.directory.next })).toBeEnabled();
  });

  it('localizes field names and coded email validation errors and explains the preview', async () => {
    const coded = {
      ...preview,
      preview: preview.preview.map((row, index) => index === 0 ? { ...row, status: 'invalid', normalizedPayload: null, errors: [`Invalid row: email: ${MARKETING_IMPORT_EMAIL_MISSING}`] } : row),
      errors: [
        { rowNumber: 1, message: `Invalid row: email: ${MARKETING_IMPORT_EMAIL_MISSING}` },
        { rowNumber: 2, message: `Invalid row: email: ${MARKETING_IMPORT_EMAIL_INVALID}; consentAt: Invalid datetime` },
      ],
    };
    installDirectoryFixture(previewFixture);
    server.use(http.post('/api/marketing/contact-imports/:id/validate', () => HttpResponse.json({ ok: true, data: coded })));
    await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import', previewFixture.route);
    expect(await screen.findByText(en.directory.previewHint)).toBeInTheDocument();
    expect(screen.getAllByText(en.directory.importErrors.emailMissing).length).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(en.directory.importErrors.emailInvalid))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${en.directory.importErrors.emailInvalid}; consentAt: Invalid datetime`))).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'email' })).toHaveTextContent(en.directory.importFields.email);
    const missing = marketingImportRowSchema.safeParse({});
    const invalid = marketingImportRowSchema.safeParse({ email: 'not-an-address' });
    expect(missing.success ? [] : missing.error.issues.map((issue) => issue.message)).toContain(MARKETING_IMPORT_EMAIL_MISSING);
    expect(invalid.success ? [] : invalid.error.issues.map((issue) => issue.message)).toContain(MARKETING_IMPORT_EMAIL_INVALID);
  });

  it('shows the single-opt-in hint only while no consent definition is selected', async () => {
    installDirectoryFixture(uploadFixture);
    await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import');
    uploadFile('email,name\nperson@example.org,Example Person');
    await userEvent.click(screen.getByRole('button', { name: en.directory.next }));
    expect(screen.getByText(en.directory.doiHint)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: en.directory.consentDefinition }));
    await userEvent.click(screen.getByRole('option', { name: 'directory-news' }));
    expect(screen.queryByText(en.directory.doiHint)).not.toBeInTheDocument();
  });
});
