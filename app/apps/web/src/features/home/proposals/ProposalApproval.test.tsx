import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { changeProposalOperationSchema, type ChangeProposalOperation } from '#core/domain/index.js';

import { en } from '../../../i18n/en.js';
import { pl } from '../../../i18n/pl.js';
import { formatPrice } from '../../../lib/format.js';
import { ApprovalImagesNote, ApprovalSummary, type ApprovalFacts } from './ProposalApproval.js';

const t = en.changeProposals;

const normalized = (text: string): string => text.replace(/\s+/gu, ' ');

const product = { id: 'proposal-mug', target: { kind: 'product' as const, id: 'product-mug' }, targetLabel: 'Mug', targetPrice: null, appliedResourceId: null };

const samples: Record<ChangeProposalOperation, ApprovalFacts> = {
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

const COUNTS_EVERY_ROW: ReadonlySet<ChangeProposalOperation> = new Set(['product.update', 'sales-link.update', 'settings.update']);

const WHOLE_RECORD: ReadonlySet<ChangeProposalOperation> = new Set(['product.create', 'product.delete-draft', 'sales-link.create', 'sales-link.delete']);

describe('the approval confirmation', () => {
  it('says nothing else changes after every operation sentence that names all of its rows', () => {
    for (const operation of changeProposalOperationSchema.options) {
      expect(summaryOf(samples[operation]), operation).toMatch(new RegExp(`${t.approveNothingElse}$`, 'u'));
    }
  });

  it('never claims nothing else changes while an effect row is left unnamed', () => {
    for (const operation of changeProposalOperationSchema.options) {
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
