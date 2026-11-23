import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { registeredChangeProposalOperationSchema, type RegisteredChangeProposalOperation } from '#core/domain/index.js';

import { en } from '../../../i18n/en.js';
import { pl } from '../../../i18n/pl.js';
import { formatPrice } from '../../../lib/format.js';
import { groupReferences } from './proposal-display.js';
import { ApprovalFilesNote, ApprovalImagesNote, ApprovalSummary, GroupAccessSentences, GroupFileSentences, type ApprovalFacts } from './ProposalApproval.js';
import { AccessChangeRow } from './ProposedAccess.js';

const t = en.changeProposals;

const normalized = (text: string): string => text.replace(/\s+/gu, ' ');

const product = { id: 'proposal-mug', target: { kind: 'product' as const, id: 'product-mug' }, targetLabel: 'Mug', targetPrice: null, appliedResourceId: null };

const mugGuide = {
  id: 'file-mug-guide',
  lineageId: 'file-mug-guide',
  versionNumber: 1,
  latest: true,
  fileName: 'mug-guide.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1_048_576,
  fingerprint: null,
  versionNote: null,
};

const FINGERPRINT = 'ab'.repeat(32);

const careSheet = { ...mugGuide, id: 'staged-care-sheet', lineageId: 'staged-care-sheet', fileName: 'care-sheet.pdf', fingerprint: FINGERPRINT };

const mugGuideSecond = { ...mugGuide, id: 'staged-mug-guide-2', versionNumber: 2, sizeBytes: 2_097_152, fingerprint: FINGERPRINT };

const samples: Record<RegisteredChangeProposalOperation, ApprovalFacts> = {
  'product.create': {
    ...product, operation: 'product.create', target: { kind: 'product', id: null }, targetLabel: null, input: { title: 'Mug' },
    effect: { exists: { before: false, after: true }, title: { before: null, after: 'Mug' } },
  },
  'product.update': { ...product, operation: 'product.update', input: { id: 'product-mug', title: 'Big mug' }, effect: { title: { before: 'Mug', after: 'Big mug' } } },
  'product.publish': { ...product, operation: 'product.publish', input: { id: 'product-mug' }, effect: { published: { before: false, after: true } } },
  'product.unpublish': { ...product, operation: 'product.unpublish', input: { id: 'product-mug' }, effect: { published: { before: true, after: false } } },
  'product.delete-draft': {
    ...product, operation: 'product.delete-draft', input: { productId: 'product-mug' },
    effect: { exists: { before: true, after: false }, title: { before: 'Mug', after: null } },
  },
  'price.create': {
    ...product, operation: 'price.create', input: { productId: 'product-mug', kind: 'one_time', amountCents: 2500, currency: 'EUR' },
    effect: { activePrices: { before: [], after: [{ kind: 'one_time', interval: null, amountCents: 2500, currency: 'EUR' }] } },
  },
  'price.deactivate': {
    ...product, operation: 'price.deactivate', target: { kind: 'price', id: 'price-mug' },
    targetPrice: { kind: 'one_time', interval: null, intervalCount: 1, amountCents: 2500, currency: 'EUR' },
    input: { id: 'price-mug' }, effect: { active: { before: true, after: false } },
  },
  'stock.enable': {
    ...product, operation: 'stock.enable', input: { productId: 'product-mug', onHand: 10 },
    effect: { tracked: { before: false, after: true }, onHand: { before: null, after: 10 } },
  },
  'stock.adjust': { ...product, operation: 'stock.adjust', input: { productId: 'product-mug', delta: 5, reason: 'Count' }, effect: { onHand: { delta: 5 } } },
  'stock.set-threshold': {
    ...product, operation: 'stock.set-threshold', input: { productId: 'product-mug', lowStockThreshold: 3 },
    effect: { lowStockThreshold: { before: 2, after: 3 } },
  },
  'sales-link.create': {
    ...product, operation: 'sales-link.create', target: { kind: 'sales-link', id: null }, targetLabel: null, input: { title: 'Spring' },
    effect: { exists: { before: false, after: true }, title: { before: null, after: 'Spring' } },
  },
  'sales-link.update': {
    ...product, operation: 'sales-link.update', target: { kind: 'sales-link', id: 'link-spring' }, targetLabel: 'Spring',
    input: { id: 'link-spring', title: 'Summer' }, effect: { title: { before: 'Spring', after: 'Summer' } },
  },
  'sales-link.delete': {
    ...product, operation: 'sales-link.delete', target: { kind: 'sales-link', id: 'link-spring' }, targetLabel: 'Spring',
    input: { id: 'link-spring' }, effect: { exists: { before: true, after: false }, title: { before: 'Spring', after: null } },
  },
  'settings.update': {
    ...product, operation: 'settings.update', target: { kind: 'settings', id: null }, targetLabel: null,
    input: { shopName: 'Acme' }, effect: { shopName: { before: 'Old', after: 'Acme' } },
  },
  'product.set-access': {
    ...product, operation: 'product.set-access', input: { id: 'product-mug', accessItems: [{ level: 'course', courseId: 'course-intro' }] },
    effect: { accessItems: { before: [], after: [{ level: 'course', courseId: 'course-intro' }] } },
    accessLabels: { courses: [{ id: 'course-intro', title: 'Intro course' }], modules: [], lessons: [] },
  },
  'download.add': {
    ...product, operation: 'download.add', input: { productId: 'product-mug', stagedFileId: careSheet.id },
    effect: { files: { before: [mugGuide], after: [mugGuide, careSheet] } },
  },
  'download.replace': {
    ...product, operation: 'download.replace', input: { productId: 'product-mug', replacesAssetId: mugGuide.id, stagedFileId: mugGuideSecond.id },
    effect: { files: { before: [mugGuide], after: [{ ...mugGuide, latest: false }, mugGuideSecond] } },
  },
  'download.remove': {
    ...product, operation: 'download.remove', input: { productId: 'product-mug', assetId: mugGuide.id },
    effect: { files: { before: [mugGuide], after: [] } },
  },
};

const summaryOf = (proposal: ApprovalFacts): string => {
  const { unmount } = render(<ApprovalSummary proposal={proposal} />);
  const text = normalized(screen.getByTestId('proposal-approve-summary').textContent ?? '');
  unmount();
  return text;
};

const withUnnamedRow = (proposal: ApprovalFacts): ApprovalFacts => ({
  ...proposal,
  effect: { ...proposal.effect, giftWrap: { before: false, after: true } },
});

const COUNTS_EVERY_ROW: ReadonlySet<RegisteredChangeProposalOperation> = new Set(['product.update', 'sales-link.update', 'settings.update']);

const WHOLE_RECORD: ReadonlySet<RegisteredChangeProposalOperation> = new Set(['product.create', 'product.delete-draft', 'sales-link.create', 'sales-link.delete']);

describe('the approval confirmation', () => {
  it('says nothing else changes after every operation sentence that names all of its rows', () => {
    expect(registeredChangeProposalOperationSchema.options).toHaveLength(18);
    for (const operation of registeredChangeProposalOperationSchema.options) {
      expect(summaryOf(samples[operation]), operation).toMatch(new RegExp(`${t.approveNothingElse}$`, 'u'));
    }
  });

  it('never claims nothing else changes while an effect row is left unnamed', () => {
    for (const operation of registeredChangeProposalOperationSchema.options) {
      const summary = summaryOf(withUnnamedRow(samples[operation]));
      if (COUNTS_EVERY_ROW.has(operation) || WHOLE_RECORD.has(operation)) {
        expect(summary, operation).toMatch(new RegExp(`${t.approveNothingElse}$`, 'u'));
      } else {
        expect(summary, operation).not.toContain(t.approveNothingElse);
        expect(summary, operation).toMatch(new RegExp(`${t.approveOtherFields({ count: 1 })}$`, 'u'));
      }
    }
  });

  it('counts the unnamed row in the sentences that count fields', () => {
    expect(summaryOf(withUnnamedRow(samples['product.update']))).toBe(`${t.approveFieldsChange({ target: 'Mug', count: 2 })} ${t.approveNothingElse}`);
    expect(summaryOf(withUnnamedRow(samples['sales-link.update']))).toBe(`${t.approveFieldsChange({ target: 'Spring', count: 2 })} ${t.approveNothingElse}`);
    expect(summaryOf(withUnnamedRow(samples['settings.update']))).toBe(`${t.approveSettingsChange({ count: 2 })} ${t.approveNothingElse}`);
  });

  it('counts the fields of a product and a sales link update', () => {
    const product = { ...samples['product.update'], effect: {
      title: { before: 'Mug', after: 'Big mug' }, slug: { before: 'mug', after: 'big-mug' }, published: { before: false, after: true },
    } };
    expect(summaryOf(product)).toBe(`${t.approveFieldsChange({ target: 'Mug', count: 3 })} ${t.approveNothingElse}`);
    expect(t.approveFieldsChange({ target: 'Mug', count: 3 })).toBe('3 fields of “Mug” will change.');
    expect(summaryOf(samples['sales-link.update'])).toBe(`${t.approveFieldsChange({ target: 'Spring', count: 1 })} ${t.approveNothingElse}`);
    expect(t.approveFieldsChange({ target: 'Spring', count: 1 })).toBe('1 field of “Spring” will change.');
    for (const count of [1, 3, 5]) {
      expect(pl.changeProposals.approveFieldsChange({ target: 'Mug', count })).toMatch(/^„Mug”: /u);
    }
  });

  it('names the starting count of a stock that starts being tracked, and its alert level when set', () => {
    expect(summaryOf(samples['stock.enable'])).toBe(`${t.approveStockEnable({ target: 'Mug', count: 10 })} ${t.approveNothingElse}`);
    expect(t.approveStockEnable({ target: 'Mug', count: 10 })).toContain('10 pieces on hand');

    const withThreshold = { ...samples['stock.enable'], effect: { ...samples['stock.enable'].effect, lowStockThreshold: { before: null, after: 3 } } };
    expect(summaryOf(withThreshold)).toBe(`${t.approveStockEnableWithThreshold({ target: 'Mug', count: 10, threshold: 3 })} ${t.approveNothingElse}`);
    expect(t.approveStockEnableWithThreshold({ target: 'Mug', count: 10, threshold: 3 })).toContain('low-stock alert level at 3');
  });

  it('words a negative stock delta as pieces removed, without a sign', () => {
    const removal = { ...samples['stock.adjust'], input: { productId: 'product-mug', delta: -3, reason: 'Damaged' }, effect: { onHand: { delta: -3 } } };
    const summary = summaryOf(removal);
    expect(summary).toBe(`${t.approveStockRemoved({ target: 'Mug', count: 3 })} ${t.approveNothingElse}`);
    expect(summary).toContain('3 pieces will be removed from stock');
    expect(summary).not.toMatch(/[-−]3/u);
    expect(summaryOf(samples['stock.adjust'])).toContain('5 pieces will be added to stock');
  });

  it('counts every row when it cannot name the target', () => {
    const gone = { ...samples['product.publish'], targetLabel: null };
    expect(summaryOf(gone)).toBe(`${t.approveFallback({ operation: t.operation['product.publish'] })} ${t.approveFieldCount({ count: 1 })}`);
  });

  it('repeats the price terms of a new price', () => {
    expect(summaryOf(samples['price.create'])).toBe(normalized(
      `${t.approvePriceCreate({ target: 'Mug', price: t.priceOneTime({ price: formatPrice(2500, 'EUR', 'en') }) })} ${t.approveNothingElse}`,
    ));
  });
});

const coverPath = (seed: string, extension = 'png'): string => `/api/public/assets/product-cover/${seed.repeat(64)}.${extension}`;

const coverChange = (id: string, after: string, before: string | null = null): ApprovalFacts => ({
  ...samples['product.update'],
  id,
  input: { id: 'product-mug', coverUrl: after },
  effect: { coverUrl: { before, after } },
});

const dialogText = (element: ReactElement): string => {
  const { container, unmount } = render(<div>{element}</div>);
  const text = normalized(container.textContent ?? '');
  unmount();
  return text;
};

describe('the approval confirmation of a proposed image', () => {
  it('adds that approving makes the proposed image public, after the sentence that names every effect row', () => {
    const proposal = coverChange('proposal-cover', coverPath('a'));
    expect(summaryOf(proposal)).toBe(`${t.approveFieldsChange({ target: 'Mug', count: 1 })} ${t.approveNothingElse}`);
    render(<ApprovalSummary proposal={proposal} />);
    expect(screen.getByTestId('proposal-approve-images')).toHaveTextContent(t.approveImagesPublic({ count: 1 }));
    expect(t.approveImagesPublic({ count: 1 })).toContain('public at the address shown');
    expect(t.approveImagesPublic({ count: 1 })).toContain('If it no longer exists, nothing is changed.');
  });

  it('says nothing about publication when no proposed image awaits approval', () => {
    render(<ApprovalSummary proposal={coverChange('proposal-public-cover', '/api/public/assets/product-cover/field-guide.webp')} />);
    render(<ApprovalSummary proposal={samples['product.update']} />);
    expect(screen.queryByTestId('proposal-approve-images')).toBeNull();
  });

  it('counts each distinct proposed image once across a group and says none of the changes applies when one is gone', () => {
    const items = [
      coverChange('proposal-first', coverPath('a')),
      coverChange('proposal-second', coverPath('b')),
      coverChange('proposal-third', coverPath('a')),
      samples['product.publish'],
    ];
    expect(dialogText(<ApprovalImagesNote proposals={items} group />)).toBe(t.approveGroupImagesPublic({ count: 2 }));
    expect(t.approveGroupImagesPublic({ count: 2 })).toContain('If one of them no longer exists, none of the changes is applied.');
    expect(dialogText(<ApprovalImagesNote proposals={[samples['product.publish']]} group />)).toBe('');
  });

  it('words the publication sentence with the Polish plural forms', () => {
    const polish = pl.changeProposals;
    expect(polish.approveImagesPublic({ count: 1 })).toMatch(/^Po zatwierdzeniu proponowany obrazek stanie /u);
    expect(polish.approveGroupImagesPublic({ count: 3 })).toContain('3 proponowane obrazki stan');
    expect(polish.approveGroupImagesPublic({ count: 5 })).toContain('5 proponowanych obrazk');
    expect(polish.approveGroupImagesPublic({ count: 22 })).toContain('22 proponowane obrazki');
    expect(polish.approveGroupImagesPublic({ count: 12 })).toContain('12 proponowanych obrazk');
  });
});

const OVERRIDE = '\u202E';

const filesNoteOf = (element: ReactElement): string => dialogText(element);

describe('the approval confirmation of a file proposal', () => {
  it('names the added file with its facts, the product and who can download it, then that nothing else changes', () => {
    const summary = summaryOf(samples['download.add']);
    expect(summary).toBe(normalized(
      `“care-sheet.pdf” (PDF, 1 MB, fingerprint ${FINGERPRINT.slice(0, 12)}${FINGERPRINT}) will be added to “Mug”. `
      + 'Everyone who has access to this product, current buyers included, can download it at once. Nothing else changes.',
    ));
    render(<ApprovalSummary proposal={samples['download.add']} />);
    expect(screen.getByTestId('file-fingerprint')).toHaveAttribute('title', FINGERPRINT);
    expect(screen.getByTestId('proposal-approve-files')).toHaveTextContent(t.approveFileMissing);
    expect(screen.getByTestId('proposal-approve-files')).not.toHaveTextContent(t.fileRemoveOnlyFile);
  });

  it('names the file of a new version once when the new version keeps its name', () => {
    const summary = summaryOf(samples['download.replace']);
    expect(summary).toMatch(
      /^A new version of “mug-guide\.pdf” \(PDF, 2 MB, fingerprint abababababab(ab)+\) becomes version 2 in “Mug”; buyers get the new version\. Nothing else changes\.$/u,
    );
    expect(summary.match(/mug-guide\.pdf/gu)).toHaveLength(1);
    expect(dialogText(<ApprovalFilesNote proposals={[samples['download.replace']]} group={false} />)).toBe(t.approveFileMissing);
  });

  it('names both files of a new version when the new version is named differently', () => {
    const renamed = { ...mugGuideSecond, fileName: 'mug-guide-2027.pdf' };
    const proposal = { ...samples['download.replace'], effect: { files: { before: [mugGuide], after: [{ ...mugGuide, latest: false }, renamed] } } };
    expect(summaryOf(proposal)).toMatch(
      /^“mug-guide-2027\.pdf” \(PDF, 2 MB, fingerprint abababababab(ab)+\) becomes version 2 of “mug-guide\.pdf” in “Mug”; buyers get the new version\. Nothing else changes\.$/u,
    );
  });

  it('says buyers lose a removed file and warns about a published product only when no file is left', () => {
    expect(summaryOf(samples['download.remove'])).toBe(
      `Buyers of “Mug” will no longer be able to download “mug-guide.pdf” version 1. ${t.fileNoVersionLeft} ${t.approveNothingElse}`,
    );
    expect(dialogText(<ApprovalFilesNote proposals={[samples['download.remove']]} group={false} />)).toBe(t.fileRemoveOnlyFile);
    expect(t.fileRemoveOnlyFile).toBe('This is the product’s only file. If the product is published when you approve, it stays published with nothing to download.');
    const kept = { ...samples['download.remove'], effect: { files: { before: [{ ...mugGuide, latest: false }, mugGuideSecond], after: [mugGuide] } }, input: { productId: 'product-mug', assetId: mugGuideSecond.id } };
    expect(summaryOf(kept)).toBe(
      `Buyers of “Mug” will no longer be able to download “mug-guide.pdf” version 2. ${t.fileBecomesCurrent({ version: 1 })} ${t.approveNothingElse}`,
    );
    expect(dialogText(<ApprovalFilesNote proposals={[kept]} group={false} />)).toBe('');
    const otherFile = { ...careSheet, id: 'file-care-sheet', lineageId: 'file-care-sheet' };
    const otherLeft = { ...samples['download.remove'], effect: { files: { before: [mugGuide, otherFile], after: [otherFile] } } };
    expect(summaryOf(otherLeft)).toBe(
      `Buyers of “Mug” will no longer be able to download “mug-guide.pdf” version 1. ${t.fileNoVersionLeft} ${t.approveNothingElse}`,
    );
    expect(dialogText(<ApprovalFilesNote proposals={[otherLeft]} group={false} />)).toBe('');
  });

  it('names the product a copied file comes from, isolated, and says plainly when that product is gone', () => {
    const title = `Mug${OVERRIDE}tnirp`;
    const copied = { ...samples['download.add'], proposedFiles: [{ id: careSheet.id, available: true, copiedFrom: { productId: 'product-cup', productTitle: title, versionNumber: 2 } }] };
    expect(summaryOf(copied)).toBe(normalized(
      `“care-sheet.pdf” (PDF, 1 MB, fingerprint ${FINGERPRINT.slice(0, 12)}${FINGERPRINT}) will be added to “Mug”. `
      + `Everyone who has access to this product, current buyers included, can download it at once. It is a copy of version 2 of a file from “${title}”. Nothing else changes.`,
    ));
    const { unmount } = render(<ApprovalSummary proposal={copied} />);
    const summary = screen.getByTestId('proposal-approve-summary');
    expect([...summary.querySelectorAll('bdi')].map((bdi) => bdi.textContent)).toEqual(['care-sheet.pdf', 'Mug', title]);
    const outside = summary.cloneNode(true);
    if (!(outside instanceof Element)) throw new Error('not an element');
    outside.querySelectorAll('bdi').forEach((bdi) => bdi.remove());
    expect(outside.textContent).not.toContain(OVERRIDE);
    unmount();

    const version = { ...samples['download.replace'], proposedFiles: [{ id: mugGuideSecond.id, available: true, copiedFrom: { productId: 'product-cup', productTitle: null, versionNumber: 3 } }] };
    expect(summaryOf(version)).toMatch(/buyers get the new version\. It is a copy of version 3 of a file from a product that no longer exists\. Nothing else changes\.$/u);
    expect(summaryOf(samples['download.add'])).not.toContain('copy');
  });

  it('isolates a file name with a direction override inside the confirmation sentence', () => {
    const name = `care${OVERRIDE}fdp.exe`;
    const proposal = { ...samples['download.add'], effect: { files: { before: [mugGuide], after: [mugGuide, { ...careSheet, fileName: name }] } } };
    render(<ApprovalSummary proposal={proposal} />);
    const summary = screen.getByTestId('proposal-approve-summary');
    expect([...summary.querySelectorAll('bdi')].map((bdi) => bdi.textContent)).toEqual([name, 'Mug']);
    const outside = summary.cloneNode(true);
    if (!(outside instanceof Element)) throw new Error('not an element');
    outside.querySelectorAll('bdi').forEach((bdi) => bdi.remove());
    expect(outside.textContent).not.toContain(OVERRIDE);
  });

  it('falls back to counting the field when the file list changed beyond the proposed file', () => {
    const extra = { ...samples['download.add'], effect: { files: { before: [mugGuide], after: [{ ...mugGuide, fileName: 'renamed.pdf' }, careSheet] } } };
    expect(summaryOf(extra)).toBe(`${t.approveFallback({ operation: t.operation['download.add'] })} ${t.approveFieldCount({ count: 1 })}`);
  });

  it('adds for a group the sentence of every file item, the removal warning and that none of the changes applies when a file is gone', () => {
    const items = [
      { ...samples['download.add'], id: 'item-add', target: { kind: 'product' as const, id: '$proposal:item-product' }, targetLabel: null },
      { ...samples['download.remove'], id: 'item-remove' },
      { ...samples['product.publish'], id: 'item-publish' },
    ];
    const references = groupReferences([
      { id: 'item-product', operation: 'product.create', input: { title: 'Field Guide (digital)' }, targetLabel: null, groupPosition: 1 },
    ]);
    const sentences = dialogText(<GroupFileSentences items={items} references={references} />);
    expect(sentences).toContain(
      'will be added to “Field Guide (digital)”. Everyone who later gets access to this product can download the file.',
    );
    expect(sentences).not.toContain('current buyers included');
    expect(sentences).toContain('Buyers of “Mug” will no longer be able to download “mug-guide.pdf” version 1.');
    expect(sentences).not.toContain(t.approveNothingElse);
    expect(filesNoteOf(<ApprovalFilesNote proposals={items} group />)).toBe(`${t.fileRemoveOnlyFile} ${t.approveGroupFilesMissing({ count: 1 })}`);
    expect(t.approveGroupFilesMissing({ count: 2 })).toBe('If one of the 2 proposed files no longer exists, none of the changes is applied.');
    expect(dialogText(<ApprovalFilesNote proposals={[samples['product.publish']]} group />)).toBe('');
  });

  it('keeps the sentence about current buyers for a file a group adds to an existing product', () => {
    const items = [{ ...samples['download.add'], id: 'item-add' }];
    expect(dialogText(<GroupFileSentences items={items} references={groupReferences([])} />))
      .toContain('will be added to “Mug”. Everyone who has access to this product, current buyers included, can download it at once.');
  });

  it('names the product a copied file comes from in a group confirmation, isolated', () => {
    const title = `Mug${OVERRIDE}tnirp`;
    const copy = { ...samples['download.add'], id: 'item-copy' };
    const items = [{ ...copy, proposedFiles: [{ id: careSheet.id, available: true, copiedFrom: { productId: 'product-cup', productTitle: title, versionNumber: 2 } }] }];
    const { container, unmount } = render(<GroupFileSentences items={items} references={groupReferences([])} />);
    const sentence = screen.getByTestId('proposal-approve-file-item-copy');
    expect(normalized(sentence.textContent ?? '')).toMatch(new RegExp(`can download it at once\\. It is a copy of version 2 of a file from “Mug${OVERRIDE}tnirp”\\.$`, 'u'));
    expect([...sentence.querySelectorAll('bdi')].map((bdi) => bdi.textContent)).toEqual(['care-sheet.pdf', 'Mug', title]);
    const outside = container.cloneNode(true);
    if (!(outside instanceof Element)) throw new Error('not an element');
    outside.querySelectorAll('bdi').forEach((bdi) => bdi.remove());
    expect(outside.textContent).not.toContain(OVERRIDE);
    unmount();

    const gone = [{ ...copy, proposedFiles: [{ id: careSheet.id, available: true, copiedFrom: { productId: 'product-cup', productTitle: null, versionNumber: 2 } }] }];
    expect(dialogText(<GroupFileSentences items={gone} references={groupReferences([])} />)).toContain(t.approveFileCopiedFromGone({ version: 2 }));
  });

  it('warns about a product left without a file in a group only when no later item gives it a file again', () => {
    const lastRemoved = { ...samples['download.remove'], id: 'item-remove' };
    const kept = { ...samples['download.remove'], id: 'item-remove-kept', effect: { files: { before: [{ ...mugGuide, latest: false }, mugGuideSecond], after: [mugGuide] } } };
    const addedAgain = { ...samples['download.add'], id: 'item-add-again', effect: { files: { before: [], after: [careSheet] } } };
    expect(filesNoteOf(<ApprovalFilesNote proposals={[lastRemoved, samples['product.publish']]} group />)).toBe(t.fileRemoveOnlyFile);
    expect(filesNoteOf(<ApprovalFilesNote proposals={[kept]} group />)).toBe('');
    expect(filesNoteOf(<ApprovalFilesNote proposals={[lastRemoved, addedAgain]} group />)).toBe(t.approveGroupFilesMissing({ count: 1 }));
    expect(filesNoteOf(<ApprovalFilesNote proposals={[addedAgain, lastRemoved]} group />)).toBe(`${t.fileRemoveOnlyFile} ${t.approveGroupFilesMissing({ count: 1 })}`);
  });

  it('words the file sentences in Polish with the file and product quoted', () => {
    const polish = pl.changeProposals;
    expect(polish.approveFileAdd({ file: 'a.pdf', facts: 'PDF, 1 MB', target: 'Mug' })).toMatch(/^Plik „a\.pdf” \(PDF, 1 MB\) zostanie dodany do produktu „Mug”\./u);
    expect(polish.approveFileAddToNewProduct({ file: 'a.pdf', facts: 'PDF, 1 MB', target: 'Mug' }))
      .toMatch(/^Plik „a\.pdf” \(PDF, 1 MB\) zostanie dodany do produktu „Mug”\. Ka\p{L}dy, kto p\p{L}\p{L}niej otrzyma dost\p{L}p do tego produktu, b\p{L}dzie m\p{L}g\p{L} pobra\p{L} plik\.$/u);
    expect(polish.approveFileMissing).toMatch(/^Je\p{L}li proponowanego pliku ju\p{L} nie ma, zatwierdzenie niczego nie wprowadzi\.$/u);
    expect(polish.fileNoVersionLeft).toMatch(/^Nie pozostanie \p{L}adna wersja tego pliku\.$/u);
    expect(`${polish.approveNothingElse} ${polish.approveFileMissing}`.match(/nie zmieni/gu)).toHaveLength(1);
    expect(t.approveFileMissing).toBe('If the proposed file no longer exists, approving does nothing.');
    expect(polish.approveFileNewVersion({ file: 'a.pdf', facts: 'PDF, 1 MB', version: 2, target: 'Mug' }))
      .toMatch(/^Nowa wersja pliku „a\.pdf” \(PDF, 1 MB\) stanie si\p{L} wersj\p{L} 2 w produkcie „Mug”; /u);
    expect(polish.approveFileCopiedFrom({ version: 2, product: 'Mug' })).toBe('To kopia wersji 2 pliku z produktu „Mug”.');
    expect(polish.approveFileCopiedFromGone({ version: 2 })).toMatch(/^To kopia wersji 2 pliku z produktu, kt/u);
    expect(polish.fileRemoveOnlyFile).toMatch(/^To jedyny plik produktu\. Je\p{L}li produkt /u);
    expect(polish.approveGroupFilesMissing({ count: 1 })).not.toMatch(/\d/u);
    expect(polish.approveGroupFilesMissing({ count: 5 })).toContain('5 proponowanych plik');
  });
});

type StoredAccessItem = ApprovalFacts['input'][string];

const accessChange = (after: StoredAccessItem[], labels: ApprovalFacts['accessLabels'], before: StoredAccessItem[] = []): ApprovalFacts => ({
  ...samples['product.set-access'],
  input: { id: 'product-mug', accessItems: after },
  effect: { accessItems: { before, after } },
  ...(labels === undefined ? {} : { accessLabels: labels }),
});

const LABELS = {
  courses: [{ id: 'course-intro', title: 'Intro course' }, { id: 'course-deep', title: 'Deep course' }],
  modules: [{ id: 'module-basics', title: 'Basics' }, { id: 'module-extra', title: 'Extras' }],
  lessons: [{ id: 'lesson-welcome', title: 'Welcome' }, { id: 'lesson-goodbye', title: 'Goodbye' }, { id: 'lesson-retired', title: null }],
};

const EVERY_KIND: StoredAccessItem[] = [
  { level: 'course', courseId: 'course-intro', excludedModuleIds: ['module-extra'] },
  { level: 'modules', courseId: 'course-deep', moduleIds: ['module-basics'] },
  { level: 'lessons', courseId: 'course-intro', lessonIds: ['lesson-welcome', 'lesson-goodbye'] },
];

const textOutsideBdi = (element: Element): string => {
  const outside = element.cloneNode(true);
  if (!(outside instanceof Element)) throw new Error('not an element');
  outside.querySelectorAll('bdi').forEach((bdi) => bdi.remove());
  return outside.textContent ?? '';
};

const groupWithNewProduct = groupReferences([
  { id: 'item-product', operation: 'product.create', input: { title: 'Starter pack' }, targetLabel: null, groupPosition: 1 },
]);

describe('the approval confirmation of what a product grants', () => {
  it('says what buyers get in words, that current buyers get what the list names at once, and that nothing else changes', () => {
    expect(summaryOf(samples['product.set-access'])).toBe(
      'Buyers of “Mug” will get access to: the whole course “Intro course”. Everyone who already has access to this product, current buyers included, '
      + 'gets what this list names at once and loses what it no longer names, unless another of their products still opens it for them. Nothing else changes.',
    );
  });

  it('names excluded modules and says that a module or a lesson opens in every course that uses it', () => {
    const summary = summaryOf(accessChange(EVERY_KIND, LABELS));
    expect(summary).toContain('the course “Intro course” without its module “Extras”');
    expect(summary).toContain('the module “Basics” in every course that uses it (chosen from “Deep course”)');
    expect(summary).toContain('the lessons “Welcome”, “Goodbye”, each in every course that uses it (chosen from “Intro course”)');
    expect(summary).not.toContain('as such');
  });

  it('says the product will grant nothing and that current buyers lose what it granted when the new list is empty', () => {
    expect(summaryOf(accessChange([], LABELS, [{ level: 'course', courseId: 'course-intro' }]))).toBe(
      `${t.approveProductSetAccessNothing({ target: 'Mug' })} ${t.approveNothingElse}`,
    );
    expect(t.approveProductSetAccessNothing({ target: 'Mug' })).toContain('current buyers included, loses what it granted at once');
  });

  it('adds the id to a title that another course, module or lesson of the proposal shares, in both lists and the confirmation', () => {
    const labels = {
      courses: [{ id: 'course-intro', title: 'Intro course' }, { id: 'course-deep', title: 'Intro course' }],
      modules: [],
      lessons: [{ id: 'lesson-first', title: 'Introduction' }, { id: 'lesson-second', title: 'Introduction' }, { id: 'lesson-welcome', title: 'Welcome' }],
      archivedCourses: ['course-deep'],
    };
    const before = [{ level: 'lessons' as const, courseId: 'course-intro', lessonIds: ['lesson-first', 'lesson-welcome'] }];
    const after = [{ level: 'lessons' as const, courseId: 'course-intro', lessonIds: ['lesson-second', 'lesson-welcome'] }];
    const rows = dialogText(<AccessChangeRow change={{ before, after }} labels={labels} label="Included access" labelComponent="h3" pending={false} />);
    expect(rows).toContain('the lessons “Introduction” (lesson-first), “Welcome”, each in every course that uses it (chosen from “Intro course” (course-intro))');
    expect(rows).toContain('the lessons “Introduction” (lesson-second), “Welcome”, each in every course that uses it (chosen from “Intro course” (course-intro))');
    expect(summaryOf(accessChange(after, labels, before)))
      .toContain('the lessons “Introduction” (lesson-second), “Welcome”, each in every course that uses it (chosen from “Intro course” (course-intro))');
    expect(dialogText(<AccessChangeRow change={{ before: [], after: [{ level: 'course', courseId: 'course-deep' }] }} labels={labels} label="Included access" labelComponent="h3" pending={false} />))
      .toContain('the whole course “Intro course” (course-deep) (archived)');
    expect(pl.changeProposals.accessNameWithId({ name: 'Intro', id: 'lesson-first' })).toBe('„Intro” (lesson-first)');
  });

  it('isolates every course, module and lesson title in the sentence', () => {
    const marked = (title: string) => `${title}${OVERRIDE}desrever`;
    const labels = {
      ...LABELS,
      courses: LABELS.courses.map((entry) => ({ ...entry, title: marked(entry.title) })),
      modules: LABELS.modules.map((entry) => ({ ...entry, title: marked(entry.title) })),
      lessons: [{ id: 'lesson-welcome', title: marked('Welcome') }, { id: 'lesson-goodbye', title: marked('Goodbye') }],
    };
    render(<ApprovalSummary proposal={accessChange(EVERY_KIND, labels)} />);
    const summary = screen.getByTestId('proposal-approve-summary');
    expect([...summary.querySelectorAll('bdi')].map((bdi) => bdi.textContent)).toEqual([
      'Mug', marked('Intro course'), marked('Extras'), marked('Basics'), marked('Deep course'), marked('Welcome'), marked('Goodbye'), marked('Intro course'),
    ]);
    expect(textOutsideBdi(summary)).not.toContain(OVERRIDE);
  });

  it('says that approving would change nothing as the shop is now, and what the list grants if it passes when the owner approves', () => {
    const refused = (access: string) => `${t.approveProductSetAccessRefused({ target: 'Mug' })} ${t.approveProductSetAccess({ target: 'Mug', access })}`;
    expect(summaryOf(accessChange([{ level: 'lessons', courseId: 'course-intro', lessonIds: ['lesson-welcome', 'lesson-retired'] }], LABELS)))
      .toBe(refused('the lessons “Welcome”, something that no longer exists (lesson-retired), each in every course that uses it (chosen from “Intro course”)'));
    expect(summaryOf(accessChange([{ level: 'course', courseId: 'course-gone' }], LABELS))).toBe(refused('the whole course something that no longer exists (course-gone)'));
    expect(summaryOf(accessChange([{ level: 'course', courseId: 'course-deep' }], { ...LABELS, archivedCourses: ['course-deep'] })))
      .toBe(refused('the whole course “Deep course” (archived)'));
    expect(t.approveProductSetAccessRefused({ target: 'Mug' })).toBe(
      'As the shop is now, the new list of what “Mug” grants does not pass the shop’s check, so approving would change nothing; if it passes the check when you approve, it applies as follows.',
    );
        expect(pl.changeProposals.approveProductSetAccessRefused({ target: 'Mug' })).toMatch(/niczego by nie zmieni\p{L}o; je\p{L}li przejdzie j\p{L} w chwili zatwierdzenia/u);
    expect(summaryOf(accessChange([{ level: 'course', courseId: 'course-intro' }], LABELS, [{ level: 'course', courseId: 'course-gone' }])))
      .toMatch(/^Buyers of “Mug” will get access to: the whole course “Intro course”\. /u);
  });

  it('words an added or lifted exclusion as what the list grants in that course, with nothing about other courses', () => {
    const plain = (access: string) =>
      `Buyers of “Mug” will get access to: ${access}. Everyone who already has access to this product, current buyers included, `
      + 'gets what this list names at once and loses what it no longer names, unless another of their products still opens it for them. Nothing else changes.';
    expect(summaryOf(accessChange(
      [{ level: 'course', courseId: 'course-intro' }],
      LABELS,
      [{ level: 'course', courseId: 'course-intro', excludedModuleIds: ['module-extra'] }],
    ))).toBe(plain('the whole course “Intro course”'));
    expect(summaryOf(accessChange(
      [{ level: 'course', courseId: 'course-deep', excludedModuleIds: ['module-extra'] }],
      LABELS,
      [{ level: 'course', courseId: 'course-intro', excludedModuleIds: ['module-extra'] }],
    ))).toBe(plain('the course “Deep course” without its module “Extras”'));
  });

  it('adds the access sentence of every access item to a group confirmation and nothing for other items', () => {
    const items = [{ ...samples['product.set-access'], id: 'item-access' }, { ...samples['product.publish'], id: 'item-publish' }];
    const text = dialogText(<GroupAccessSentences items={items} references={groupReferences([])} />);
    expect(text).toContain('Buyers of “Mug” will get access to: the whole course “Intro course”. Everyone who already has access to this product, current buyers included,');
    expect(dialogText(<GroupAccessSentences items={[samples['product.publish']]} references={groupReferences([])} />)).toBe('');
  });

  it('gives one sentence per product in a group confirmation, with the list its last access item leaves', () => {
    const step = (id: string, before: StoredAccessItem[], after: StoredAccessItem[]) => ({ ...accessChange(after, LABELS, before), id });
    const intro = [{ level: 'course' as const, courseId: 'course-intro' }];
    const deep = [{ level: 'course' as const, courseId: 'course-deep' }];
    const items = [
      step('item-first', [], intro),
      { ...samples['product.publish'], id: 'item-publish' },
      step('item-second', intro, deep),
    ];
    const text = dialogText(<GroupAccessSentences items={items} references={groupReferences([])} />);
    expect(text).toBe(`${t.approveProductSetAccess({ target: 'Mug', access: 'the whole course “Deep course”' })}`);
    expect(text).not.toContain('Intro course');
    const other = { ...step('item-other', [], intro), target: { kind: 'product' as const, id: 'product-cup' }, targetLabel: 'Cup' };
    expect(dialogText(<GroupAccessSentences items={[...items, other]} references={groupReferences([])} />)).toBe(
      `${t.approveProductSetAccess({ target: 'Mug', access: 'the whole course “Deep course”' })}${t.approveProductSetAccess({ target: 'Cup', access: 'the whole course “Intro course”' })}`,
    );
    const emptied = step('item-emptied', deep, []);
    expect(dialogText(<GroupAccessSentences items={[...items, emptied]} references={groupReferences([])} />)).toBe(t.approveProductSetAccessUnchangedNothing({ target: 'Mug' }));
    const startsWithIntro = step('item-from-intro', intro, deep);
    expect(dialogText(<GroupAccessSentences items={[startsWithIntro, emptied]} references={groupReferences([])} />)).toBe(t.approveProductSetAccessNothing({ target: 'Mug' }));
  });

  it('warns in a group confirmation when an earlier access item of a product is refused although its last list passes', () => {
    const step = (id: string, before: StoredAccessItem[], after: StoredAccessItem[], labels: ApprovalFacts['accessLabels']) =>
      ({ ...accessChange(after, labels, before), id });
    const intro = [{ level: 'course' as const, courseId: 'course-intro' }];
    const deep = [{ level: 'course' as const, courseId: 'course-deep' }];
    const items = [
      step('item-first', [], intro, { ...LABELS, archivedCourses: ['course-intro'] }),
      step('item-second', intro, deep, { courses: [{ id: 'course-deep', title: 'Deep course' }], modules: [], lessons: [] }),
    ];
    expect(dialogText(<GroupAccessSentences items={items} references={groupReferences([])} />)).toBe(
      `${t.approveGroupProductSetAccessRefused({ target: 'Mug' })} ${t.approveProductSetAccess({ target: 'Mug', access: 'the whole course “Deep course”' })}`,
    );
    expect(t.approveGroupProductSetAccessRefused({ target: 'Mug' })).toMatch(/would apply none of the changes; only if every change of the group passes its checks when you approve/u);
    expect(pl.changeProposals.approveGroupProductSetAccessRefused({ target: 'Mug' })).toMatch(/tylko wtedy, gdy w chwili zatwierdzenia ka\p{L}da jej zmiana przejdzie swoje kontrole/u);
  });

  it('says in a group confirmation that the group makes no net change to the list it started from when its last list grants that list', () => {
    const step = (id: string, before: StoredAccessItem[], after: StoredAccessItem[]) => ({ ...accessChange(after, LABELS, before), id });
    const intro = [{ level: 'course' as const, courseId: 'course-intro' }];
    const items = [step('item-add', [], intro), step('item-clear', intro, [])];
    expect(dialogText(<GroupAccessSentences items={items} references={groupReferences([])} />)).toBe(t.approveProductSetAccessUnchangedNothing({ target: 'Mug' }));
    const back = [step('item-clear', intro, []), step('item-add', [], intro)];
    expect(dialogText(<GroupAccessSentences items={back} references={groupReferences([])} />)).toBe(
      t.approveProductSetAccessUnchanged({ target: 'Mug', access: 'the whole course “Intro course”' }),
    );
    const unchangedSentences = [
      t.approveProductSetAccessUnchanged({ target: 'Mug', access: 'Intro' }),
      t.approveProductSetAccessUnchangedNothing({ target: 'Mug' }),
    ];
    for (const sentence of unchangedSentences) {
      expect(sentence).toContain('the same as the list it started from');
      expect(sentence).toContain('makes no net change to that list');
      expect(sentence).not.toMatch(/\bnow\b/u);
    }
    const polishUnchangedSentences = [
      pl.changeProposals.approveProductSetAccessUnchanged({ target: 'Mug', access: 'Intro' }),
      pl.changeProposals.approveProductSetAccessUnchangedNothing({ target: 'Mug' }),
    ];
    for (const sentence of polishUnchangedSentences) {
      expect(sentence).toMatch(/lista wyj\p{L}ciowa/u);
      expect(sentence).toMatch(/w sumie nie zmieni/u);
      expect(sentence).not.toMatch(/teraz/u);
    }
  });

  it('claims no future access for a draft the group deletes after setting its list, but keeps a refusal', () => {
    const intro = [{ level: 'course' as const, courseId: 'course-intro' }];
    const access = { ...accessChange(intro, LABELS), id: 'item-access' };
    const deleted = { ...samples['product.delete-draft'], id: 'item-delete' };
    expect(dialogText(<GroupAccessSentences items={[access, deleted]} references={groupReferences([])} />)).toBe('');
    const refused = { ...accessChange([{ level: 'course', courseId: 'course-gone' }], LABELS), id: 'item-refused' };
    expect(dialogText(<GroupAccessSentences items={[refused, deleted]} references={groupReferences([])} />)).toBe(
      t.approveGroupProductSetAccessRefusedDeleted({ target: 'Mug' }),
    );
  });

  it('adds the id to a title that a lesson of an earlier access item of the group shares with the final list', () => {
    const labelsOf = (lessons: { id: string; title: string }[]) => ({ courses: [{ id: 'course-intro', title: 'Intro course' }], modules: [], lessons });
    const lessons = (id: string) => [{ level: 'lessons' as const, courseId: 'course-intro', lessonIds: [id] }];
    const items = [
      { ...accessChange(lessons('lesson-bridge'), labelsOf([{ id: 'lesson-x', title: 'Introduction' }, { id: 'lesson-bridge', title: 'Bridge' }]), lessons('lesson-x')), id: 'item-first' },
      { ...accessChange(lessons('lesson-y'), labelsOf([{ id: 'lesson-bridge', title: 'Bridge' }, { id: 'lesson-y', title: 'Introduction' }]), lessons('lesson-bridge')), id: 'item-second' },
    ];
    expect(dialogText(<GroupAccessSentences items={items} references={groupReferences([])} />)).toContain('“Introduction” (lesson-y)');
  });

  it('words the access of a product an earlier item of the group creates without current buyers', () => {
    const created = { ...samples['product.set-access'], id: 'item-access', target: { kind: 'product' as const, id: '$proposal:item-product' }, targetLabel: null };
    const text = dialogText(<GroupAccessSentences items={[created]} references={groupWithNewProduct} />);
    expect(text).toBe('Everyone who later gets access to the new product “Starter pack” will get access to: the whole course “Intro course”.');
    expect(text).not.toContain('current buyers');
    const emptied = { ...created, effect: { accessItems: { before: [], after: [] } } };
    expect(dialogText(<GroupAccessSentences items={[emptied]} references={groupWithNewProduct} />))
      .toBe('The new product “Starter pack” will not grant any course, module or lesson.');
    const gone = { ...created, effect: { accessItems: { before: [], after: [{ level: 'course', courseId: 'course-gone' }] } } };
    expect(dialogText(<GroupAccessSentences items={[gone]} references={groupWithNewProduct} />)).toBe(
      `${t.approveGroupProductSetAccessRefused({ target: 'Starter pack' })} ${t.approveProductSetAccessNewProduct({ target: 'Starter pack', access: 'the whole course something that no longer exists (course-gone)' })}`,
    );
  });

  it('lets a 255-character name without a break opportunity wrap anywhere in the summary and the group sentences', () => {
    const name = `${'quarterly_report_'.repeat(15)}final.pdf.exe`.slice(-255);
    expect(name).toHaveLength(255);
    const proposal = { ...samples['download.add'], effect: { files: { before: [mugGuide], after: [mugGuide, { ...careSheet, fileName: name }] } } };
    const { unmount } = render(<ApprovalSummary proposal={proposal} />);
    expect(getComputedStyle(screen.getByTestId('proposal-approve-summary')).overflowWrap).toBe('anywhere');
    unmount();
    render(<GroupFileSentences items={[{ ...proposal, id: 'item-long' }]} references={groupReferences([])} />);
    expect(getComputedStyle(screen.getByTestId('proposal-approve-file-item-long')).overflowWrap).toBe('anywhere');
    expect(screen.getByTestId('proposal-approve-file-item-long')).toHaveTextContent(name);
  });

  it('words what a product grants in Polish with the list items in the nominative after the lead-in', () => {
    const polish = pl.changeProposals;
    expect(polish.operation['product.set-access']).toMatch(/^Dost\p{L}p, kt\p{L}ry daje produkt$/u);
    expect(polish.accessName({ name: 'Kurs' })).toBe('„Kurs”');
    expect(polish.accessWholeCourse({ course: '„Kurs”' })).toMatch(/^ca\p{L}y kurs „Kurs”$/u);
    expect(polish.accessModules({ course: '„Kurs”', modules: '„A”', count: 1 })).toMatch(/^modu\p{L} „A”\u00a0– w ka\p{L}dym kursie, kt\p{L}ry go zawiera \(wybrany z kursu „Kurs”\)$/u);
    expect(polish.accessLessons({ course: '„Kurs”', lessons: '„A”, „B”', count: 2 })).toMatch(/^lekcje „A”, „B”\u00a0– ka\p{L}da w ka\p{L}dym kursie, kt\p{L}ry j\p{L} zawiera/u);
    expect(polish.approveProductSetAccess({ target: 'Kubek', access: 'ACCESS' }))
      .toMatch(/^Po zatwierdzeniu produkt „Kubek” b\p{L}dzie dawa\p{L} dost\p{L}p do nast\p{L}puj\p{L}cych tre\p{L}ci: ACCESS\. .+ od razu zyska dost\p{L}p do tego, co jest na li\p{L}cie, /u);
    expect(polish.accessNothing).toMatch(/^brak kurs\p{L}w, modu\p{L}\p{L}w i lekcji$/u);
    const sentences = [
      polish.accessModules({ course: 'C', modules: 'M', count: 2 }),
      polish.accessLessons({ course: 'C', lessons: 'L', count: 1 }),
      polish.accessCourseWithout({ course: 'C', modules: 'M', count: 1 }),
      polish.accessListRefused,
      polish.approveProductSetAccess({ target: 'T', access: 'A' }),
      polish.approveProductSetAccessNothing({ target: 'T' }),
      polish.approveProductSetAccessNewProduct({ target: 'T', access: 'A' }),
      polish.approveProductSetAccessNothingNewProduct({ target: 'T' }),
    ];
    for (const sentence of sentences) expect(sentence).not.toMatch(/jako tak|t\p{L} list\p{L}|dost\p{L}p do: /u);
  });
});
