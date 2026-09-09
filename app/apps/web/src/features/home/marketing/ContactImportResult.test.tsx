import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { marketingDirectoryContracts } from '#core/client/index.js';
import { directoryTestFixtures } from './directory-test-data.js';
import { pl } from '../../../i18n/pl.js';
import { fixtureValue, installDirectoryFixture, renderDirectory } from './directory-test-helpers.js';
import { ContactImportWizard } from './ContactImportWizard.js';
import { importErrorCsv } from './ContactImportResult.js';


const fixture = directoryTestFixtures['panel-marketing-contact-result'];

const receipts = marketingDirectoryContracts.getMarketingContactImportRows.output.parse(fixtureValue(fixture, 'getMarketingContactImportRows')).rows;
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
      await userEvent.click(await screen.findByRole('button', { name: pl.directory.downloadErrors }));
      await waitFor(() => expect(click).toHaveBeenCalledOnce());
      await waitFor(() => expect(revoked).toHaveBeenCalledWith('blob:import-errors'));
      expect(document.querySelector('a[download]')).toBeNull();
    } finally {
      click.mockRestore(); URL.createObjectURL = create; URL.revokeObjectURL = revoke;
    }
  });
  it('restores a completed batch directly from its URL and distinguishes withheld consent', async () => {
    installDirectoryFixture(fixture);
    await renderDirectory(ContactImportWizard, '/panel/marketing/contacts/import', fixture.route);
    expect(await screen.findByText(pl.directory.completed_with_errors)).toBeInTheDocument();
    expect(screen.getByText(`${pl.directory.consentBlockedBySuppression}: 1`)).toBeInTheDocument();
    expect(screen.getByText(`${pl.directory.created}: 2`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: pl.directory.downloadErrors })).toBeEnabled();
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
