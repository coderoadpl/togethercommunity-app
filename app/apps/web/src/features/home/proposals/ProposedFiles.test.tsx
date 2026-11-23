import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChangeProposalOwnerView } from '#core/domain/index.js';

import { en } from '../../../i18n/en.js';
import { formatFileSize } from '../../../lib/format.js';
import { fileAddProposal, fileCopyProposal, fileLastRemoveProposal, fileRemoveProposal, fileReplaceProposal } from '../../../test/change-proposal-fixtures.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { ProposalFieldRows } from './ProposalChanges.js';

const t = en.changeProposals;

const OVERRIDE = '‮';

type FileProposal = Pick<ChangeProposalOwnerView, 'id' | 'effect' | 'input'> & Partial<Pick<ChangeProposalOwnerView, 'proposedFiles'>>;

const normalized = (text: string | null): string => (text ?? '').replace(/\s+/gu, ' ');

const at = <T,>(list: readonly T[], index: number): T => {
  const entry = list[index];
  if (entry === undefined) throw new Error(`missing entry ${String(index)}`);
  return entry;
};

const size = (bytes: number): string => formatFileSize(bytes, 'en');

const renderRows = (proposal: FileProposal, pending = true) =>
  renderWithProviders(<ProposalFieldRows proposal={proposal} pendingProposalId={pending ? proposal.id : null} />);

const textOutsideBdi = (element: Element): string => {
  const clone = element.cloneNode(true);
  if (!(clone instanceof Element)) return '';
  clone.querySelectorAll('bdi').forEach((bdi) => bdi.remove());
  return clone.textContent ?? '';
};

const fileLink = { download: { url: 'https://storage.example.org/key-files/bonus?signature=secret', expiresAt: '2026-11-21T09:01:00.000Z', fileName: 'bonus-chapter.epub', sizeBytes: 2_431_119 } };

const mockNavigation = () => {
  const assign = vi.fn();
  const real = window.location;
  const { href, origin, protocol, host, hostname, port, pathname, search, hash } = real;
  vi.spyOn(window, 'location', 'get').mockImplementation(() => ({
    ...real, href, origin, protocol, host, hostname, port, pathname, search, hash, assign, toString: () => href,
  }));
  return assign;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('proposed file rows', () => {
  it('shows an added file with its type, size and fingerprint, the full fingerprint as title and for assistive technology', () => {
    renderRows(fileAddProposal);

    const row = screen.getByTestId('proposed-file');
    expect(row).toHaveAttribute('data-change', 'added');
    const fingerprint = '3f6c9a0e12bd7a41c0e95b2d8f6a13c4e7b09d25f8a61c3e4b7d0f92a5c8e1b6';
    expect(normalized(row.querySelector('p')?.textContent ?? null))
      .toBe(`Added: bonus-chapter.epub · EPUB · ${size(2_431_119)} · fingerprint 3f6c9a0e12bd${fingerprint}`);
    const shown = within(row).getByTestId('file-fingerprint');
    expect(shown).toHaveAttribute('title', fingerprint);
    expect(shown.querySelector('[aria-hidden="true"]')).toHaveTextContent(/^3f6c9a0e12bd$/u);
    expect(within(row).getByText(fingerprint)).toBeInTheDocument();
    expect(screen.queryByTestId('proposal-field-files')).toBeNull();
    expect(within(row).queryByTestId('proposed-file-copy')).toBeNull();
    expect(within(row).getByTestId('proposed-file-download')).toHaveTextContent(t.fileDownload);
  });

  it('isolates a file name with a direction override from the sentence around it', () => {
    const name = `report${OVERRIDE}fdp.exe`;
    const kept = at(fileAddProposal.effect.files.after, 0);
    const added = at(fileAddProposal.effect.files.after, 1);
    renderRows({ ...fileAddProposal, effect: { files: { before: [kept], after: [kept, { ...added, fileName: name }] } } });

    const line = screen.getByTestId('proposed-file').querySelector('p');
    if (line === null) throw new Error('missing file line');
    expect([...line.querySelectorAll('bdi')].map((bdi) => bdi.textContent)).toEqual([name]);
    expect(textOutsideBdi(line)).not.toContain(OVERRIDE);
    expect(textOutsideBdi(line)).toContain('Added: ');
  });

  it('says plainly where a copied file comes from, and when that product is gone', () => {
    const { unmount } = renderRows(fileCopyProposal);
    const copy = screen.getByTestId('proposed-file-copy');
    expect(normalized(copy.textContent)).toBe(t.fileCopiedFrom({ version: 2, product: 'Creator Workbook (print)' }));
    expect(copy.querySelector('bdi')).toHaveTextContent('Creator Workbook (print)');
    unmount();

    const entry = at(fileCopyProposal.proposedFiles, 0);
    renderRows({ ...fileCopyProposal, proposedFiles: [{ ...entry, copiedFrom: { ...entry.copiedFrom, productTitle: null } }] });
    expect(screen.getByTestId('proposed-file-copy')).toHaveTextContent(t.fileCopiedFromGone({ version: 2 }));
  });

  it('shows the version step of a new version with the sizes before and after and its version note', () => {
    renderRows(fileReplaceProposal);

    const row = screen.getByTestId('proposed-file');
    expect(row).toHaveAttribute('data-change', 'replaced');
    expect(normalized(row.querySelector('p')?.textContent ?? null))
      .toMatch(new RegExp(`^New version of workbook\\.pdf: version 1 → 2 · PDF · ${size(13_002_342)} → ${size(13_731_020)} · fingerprint c41a7e09d3b5`, 'u'));
    expect(row).toHaveTextContent(t.fileVersionNote({ note: 'Fixed the exercises of chapter 3' }));
    expect(row).not.toHaveTextContent(t.fileNewName({ name: 'workbook.pdf' }));
  });

  it('lets a 255-character new name, version note and copy source wrap anywhere in the fine print', () => {
    const long = `${'quarterly_report_'.repeat(15)}final.pdf.exe`.slice(-255);
    const previous = at(fileReplaceProposal.effect.files.after, 0);
    const added = at(fileReplaceProposal.effect.files.after, 1);
    renderRows({
      ...fileReplaceProposal,
      effect: { files: { before: fileReplaceProposal.effect.files.before, after: [previous, { ...added, fileName: long, versionNote: long }] } },
      proposedFiles: [{ id: added.id, available: true, copiedFrom: { productId: 'product-long', productTitle: long, versionNumber: 2 } }],
    });

    const row = screen.getByTestId('proposed-file');
    const lineReading = (text: string): Element => {
      const line = [...row.querySelectorAll('p')].find((candidate) => normalized(candidate.textContent) === text);
      if (line === undefined) throw new Error(`missing line ${text}`);
      return line;
    };
    const finePrint = [lineReading(t.fileNewName({ name: long })), lineReading(t.fileVersionNote({ note: long })), screen.getByTestId('proposed-file-copy')];
    for (const line of finePrint) expect(getComputedStyle(line).overflowWrap).toBe('anywhere');
    expect(screen.getByTestId('proposed-file-copy')).toHaveTextContent(`Copy of version 2 of a file from “${long}”`);
  });

  it('names the file of a new version when it differs from the version it replaces', () => {
    const previous = at(fileReplaceProposal.effect.files.after, 0);
    const added = at(fileReplaceProposal.effect.files.after, 1);
    renderRows({ ...fileReplaceProposal, effect: { files: { before: fileReplaceProposal.effect.files.before, after: [previous, { ...added, fileName: 'workbook-2027.pdf' }] } } });

    expect(screen.getByTestId('proposed-file')).toHaveTextContent(t.fileNewName({ name: 'workbook-2027.pdf' }));
  });

  it('shows a removal with the version that becomes current and no only-file warning while a file is left, without a download', () => {
    renderRows(fileRemoveProposal);

    const row = screen.getByTestId('proposed-file');
    expect(row).toHaveAttribute('data-change', 'removed');
    expect(normalized(row.querySelector('p')?.textContent ?? null)).toBe(`Removed: workbook.pdf version 2 · PDF · ${size(13_731_020)}`);
    expect(row).toHaveTextContent(t.fileBecomesCurrent({ version: 1 }));
    expect(row).not.toHaveTextContent(t.fileRemoveOnlyFile);
    expect(within(row).queryByTestId('proposed-file-only-file')).toBeNull();
    expect(within(row).queryByTestId('proposed-file-download')).toBeNull();
  });

  it('warns that a published product keeps nothing to download only when the removal leaves no file', () => {
    renderRows(fileLastRemoveProposal);

    const row = screen.getByTestId('proposed-file');
    expect(normalized(row.textContent)).toBe(
      `Removed: sketch-pack.zip version 1 · ZIP · ${size(48_210_775)}${t.fileNoVersionLeft}${t.fileRemoveOnlyFile}`,
    );
    expect(within(row).getByTestId('proposed-file-only-file')).toHaveTextContent(
      'This is the product’s only file. If the product is published when you approve, it stays published with nothing to download.',
    );
  });

  it('says which version stays current when an earlier version is removed, and when none is left', () => {
    const first = at(fileRemoveProposal.effect.files.before, 0);
    const second = at(fileRemoveProposal.effect.files.before, 1);
    const { unmount } = renderRows({ ...fileRemoveProposal, effect: { files: { before: [first, second], after: [second] } } });
    expect(screen.getByTestId('proposed-file')).toHaveTextContent(t.fileStaysCurrent({ version: 2 }));
    expect(screen.queryByTestId('proposed-file-only-file')).toBeNull();
    unmount();

    const other = { ...first, id: 'file-answers', lineageId: 'file-answers', fileName: 'answers.pdf', latest: true };
    const { unmount: unmountOther } = renderRows({ ...fileRemoveProposal, effect: { files: { before: [{ ...first, latest: true }, other], after: [other] } } });
    expect(screen.getByTestId('proposed-file')).toHaveTextContent(t.fileNoVersionLeft);
    expect(screen.queryByTestId('proposed-file-only-file')).toBeNull();
    unmountOther();

    renderRows({ ...fileRemoveProposal, effect: { files: { before: [{ ...first, latest: true }], after: [] } } });
    expect(screen.getByTestId('proposed-file')).toHaveTextContent(t.fileNoVersionLeft);
    expect(screen.getByTestId('proposed-file-only-file')).toHaveTextContent(t.fileRemoveOnlyFile);
  });

  it('says the file is no longer held instead of offering its download, without taking focus', () => {
    renderRows({ ...fileAddProposal, proposedFiles: [{ id: 'staged-file-bonus-chapter', available: false, copiedFrom: null }] });

    expect(screen.getByTestId('proposed-file-unavailable')).toHaveTextContent(t.fileUnavailable);
    expect(screen.getByTestId('proposed-file-unavailable')).not.toHaveFocus();
    expect(screen.getByTestId('proposed-file-unavailable')).not.toHaveAttribute('tabindex');
    expect(screen.queryByTestId('proposed-file-download')).toBeNull();
  });

  it('offers no download and no availability on a decided proposal', () => {
    renderRows({ ...fileAddProposal, proposedFiles: [{ id: 'staged-file-bonus-chapter', available: false, copiedFrom: null }] }, false);

    expect(screen.queryByTestId('proposed-file-download')).toBeNull();
    expect(screen.queryByTestId('proposed-file-unavailable')).toBeNull();
  });

  it('asks the owner link while busy and navigates to it without rendering the address', async () => {
    const assign = mockNavigation();
    let release: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => { release = resolve; });
    const requested: string[] = [];
    server.use(http.get('/api/change-proposals/:id/files/:fileId', async ({ params }) => {
      requested.push(`${String(params['id'])}/${String(params['fileId'])}`);
      await answered;
      return HttpResponse.json({ ok: true, data: fileLink });
    }));
    const { container } = renderRows(fileAddProposal);

    await userEvent.click(screen.getByTestId('proposed-file-download'));
    const busy = await screen.findByText(t.fileDownloadPreparing);
    const button = busy.closest('button');
    if (button === null) throw new Error('missing download button');
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveFocus();
    await userEvent.click(button);
    expect(requested).toHaveLength(1);
    release();

    await waitFor(() => expect(assign).toHaveBeenCalledExactlyOnceWith(fileLink.download.url));
    expect(requested).toEqual([`${fileAddProposal.id}/staged-file-bonus-chapter`]);
    expect(await screen.findByTestId('proposed-file-download')).toBeEnabled();
    expect(container.innerHTML).not.toContain('storage.example.org');
  });

  it('shows the gone state in the warning style when the link route answers 404', async () => {
    const assign = mockNavigation();
    server.use(http.get('/api/change-proposals/:id/files/:fileId', () => HttpResponse.json(
      { ok: false, error: { code: 'not_found', message: 'Not found' } },
      { status: 404 },
    )));
    renderRows(fileAddProposal);

    await userEvent.click(screen.getByTestId('proposed-file-download'));

    const gone = await screen.findByTestId('proposed-file-unavailable');
    expect(gone).toHaveTextContent('This file is no longer available; approving changes nothing.');
    expect(gone).toHaveClass('MuiAlert-colorWarning');
    await waitFor(() => expect(gone).toHaveFocus());
    expect(gone).toHaveAttribute('tabindex', '-1');
    expect(screen.queryByTestId('proposed-file-download')).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it('keeps the download offered after any other failure and says it could not start', async () => {
    const assign = mockNavigation();
    server.use(http.get('/api/change-proposals/:id/files/:fileId', () => HttpResponse.json(
      { ok: false, error: { code: 'integration_unavailable', message: 'Storage failed' } },
      { status: 502 },
    )));
    renderRows(fileAddProposal);

    await userEvent.click(screen.getByTestId('proposed-file-download'));

    expect(await screen.findByTestId('proposed-file-download-failed')).toHaveTextContent(t.fileDownloadFailed);
    expect(screen.getByTestId('proposed-file-download')).toBeEnabled();
    expect(screen.queryByTestId('proposed-file-unavailable')).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });
});
