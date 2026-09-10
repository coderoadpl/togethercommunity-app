import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { marketingDirectoryContracts } from '#core/client/index.js';
import { marketingContactImportSchema, type MarketingContactImport } from '#core/domain/index.js';
import { directoryTestFixtures } from './directory-test-data.js';
import { en } from '../../../i18n/en.js';
import { fixtureValue, installDirectoryFixture, renderDirectory } from './directory-test-helpers.js';
import { ContactImportWizard } from './ContactImportWizard.js';
import { importErrorCsv } from './ContactImportResult.js';


const fixture = directoryTestFixtures['panel-marketing-contact-result'];
const result = (value: unknown) => ({ ok: true, value });
const importResult = marketingDirectoryContracts.getMarketingContactImport.output.parse(fixtureValue(fixture, 'getMarketingContactImport')).import;
const receipts = marketingDirectoryContracts.getMarketingContactImportRows.output.parse(fixtureValue(fixture, 'getMarketingContactImportRows')).rows;
const fixtureWithImport = (batch: MarketingContactImport) => ({ route: fixture.route, calls: { ...fixture.calls, 'getMarketingContactImport:[]': result({ import: batch }) } });

describe('import results', () => {
  it('keeps a connected download link alive until the next tick', async () => {
    installDirectoryFixture(fixture);
    await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import', fixture.route);
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    const revoked = vi.fn();
    URL.createObjectURL = () => 'blob:import-errors';
    URL.revokeObjectURL = revoked;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.isConnected).toBe(true);
      expect(this.download).toBe('import-import-contacts-errors.csv');
      expect(revoked).not.toHaveBeenCalled();
    });
    try {
      await userEvent.click(await screen.findByRole('button', { name: en.directory.downloadErrors }));
      await waitFor(() => expect(click).toHaveBeenCalledOnce());
      await waitFor(() => expect(revoked).toHaveBeenCalledWith('blob:import-errors'));
      expect(document.querySelector('a[download]')).toBeNull();
    } finally {
      click.mockRestore(); URL.createObjectURL = create; URL.revokeObjectURL = revoke;
    }
  });
  it('shows queued imports as in progress', async () => {
    installDirectoryFixture(directoryTestFixtures['panel-marketing-contact-queued']);
    await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import', directoryTestFixtures['panel-marketing-contact-queued'].route);
    expect(await screen.findByText(en.directory.queued)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(en.directory.queued);
    expect(screen.getByText(en.directory.statusGuidance.queued)).toBeInTheDocument();
    expect(screen.getByText(en.directory.processingHint)).toBeInTheDocument();
  });
  it('shows a clean completed import without processing or an empty error CSV', async () => {
    const cleanImport = marketingContactImportSchema.parse({ ...importResult, status: 'completed', resultCounts: { ...importResult.resultCounts, rejectedRows: 0, duplicateRows: 0 }, stagedDataPurgedAt: null });
    installDirectoryFixture(fixtureWithImport(cleanImport));
    await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import', fixture.route);
    expect(await screen.findByText(en.directory.completed)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(en.directory.completed);
    expect(screen.getByText(en.directory.statusGuidance.completed)).toBeInTheDocument();
    expect(screen.queryByText(en.directory.processingHint)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.directory.downloadErrors })).not.toBeInTheDocument();
    expect(screen.getByText(`${en.directory.batchId}: ${cleanImport.id}`)).toHaveClass('MuiTypography-caption');
  });
  it('restores a completed batch directly from its URL and distinguishes withheld consent', async () => {
    installDirectoryFixture(fixture);
    await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import', fixture.route);
    expect(await screen.findByText(en.directory.completed_with_errors)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(en.directory.completed_with_errors);
    expect(screen.getByText(en.directory.statusGuidance.completed_with_errors)).toBeInTheDocument();
    expect(screen.queryByText(en.directory.processingHint)).not.toBeInTheDocument();
    expect(screen.getByText(`${en.directory.consentBlockedBySuppression}: 1`)).toBeInTheDocument();
    expect(screen.getByText(`${en.directory.created}: 2`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.directory.downloadErrors })).toBeEnabled();
  });
  it('explains purged rejected row details instead of offering a CSV', async () => {
    const purgedImport = { ...importResult, stagedDataPurgedAt: importResult.finishedAt };
    installDirectoryFixture(fixtureWithImport(purgedImport));
    await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import', fixture.route);
    expect(await screen.findByText(en.directory.completed_with_errors)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.directory.downloadErrors })).not.toBeInTheDocument();
    expect(screen.getByText(en.directory.errorsPurged)).toBeInTheDocument();
  });
  it('exports only rejected rows and escapes quotes, newlines and spreadsheet formulas', () => {
    const rejected = receipts.find((row) => row.errors.length > 0);
    if (!rejected) throw new Error('Missing rejected fixture row');
    const csv = importErrorCsv([...receipts.filter((row) => row.errors.length === 0), { ...rejected, stagedPayload: { email: '=1+2' }, normalizedPayload: null, errors: ['Invalid "email"\nCheck source'] }]);
    expect(csv).toContain('"\'=1+2"');
    expect(csv).toContain('"Invalid ""email""\nCheck source"');
    expect(csv).not.toContain('anna@example.org');
  });
});
