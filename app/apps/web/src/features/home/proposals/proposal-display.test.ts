import { describe, expect, it } from 'vitest';

import { changeProposalGroupItems } from '../../../test/change-proposal-fixtures.js';
import {
  groupReferences,
  imageFingerprint,
  isSameOriginPublicAssetPath,
  proposalFileChanges,
  proposalRows,
  proposalTarget,
  proposedImagePaths,
  shortProposedImagePath,
  stockAdjustmentProductId,
} from './proposal-display.js';

describe('proposal display', () => {
  it('shortens only a content-addressed image address, keeping the fingerprint, the last four digest characters and the extension', () => {
    const digest = '88daee5b37693c1f5e354e2b46fbba036fa4a67a3150a00082a6176c047c271c';
    const proposed = `/api/public/assets/product-cover/${digest}.png`;
    expect(shortProposedImagePath(proposed)).toBe('/api/public/assets/product-cover/88daee5b3769…271c.png');
    expect(shortProposedImagePath(proposed)).toContain(imageFingerprint(digest));
    expect(imageFingerprint(digest)).toBe('88daee5b3769');
    expect(shortProposedImagePath('/api/public/assets/product-cover/field-guide.webp')).toBeNull();
    expect(shortProposedImagePath('https://images.example.org/a.webp')).toBeNull();
  });

  it('lists each distinct proposed image address of pending proposals once', () => {
    const first = `/api/public/assets/product-cover/${'a'.repeat(64)}.png`;
    const second = `/api/public/assets/logo/${'b'.repeat(64)}.webp`;
    expect(proposedImagePaths([
      { id: 'proposal-1', input: { coverUrl: first }, effect: { coverUrl: { before: null, after: first } } },
      { id: 'proposal-2', input: { logoUrl: second }, effect: { logoUrl: { before: null, after: second }, shopName: { before: 'Old', after: 'Acme' } } },
      { id: 'proposal-3', input: { coverUrl: first }, effect: { coverUrl: { before: '/api/public/assets/product-cover/field-guide.webp', after: first } } },
      { id: 'proposal-4', input: {}, effect: { coverUrl: { before: null, after: '/api/public/assets/product-cover/field-guide.webp' } } },
    ])).toEqual([first, second]);
  });

  it('shows an image only for a same-origin public asset path', () => {
    expect(isSameOriginPublicAssetPath('/api/public/assets/product-cover/a.webp')).toBe(true);
    expect(isSameOriginPublicAssetPath('https://images.example.org/a.webp')).toBe(false);
    expect(isSameOriginPublicAssetPath('//images.example.org/a.webp')).toBe(false);
    expect(isSameOriginPublicAssetPath('/api/public/assets/../private/a.webp')).toBe(false);
    expect(isSameOriginPublicAssetPath('javascript:alert(1)')).toBe(false);

    const rows = proposalRows({
      input: {},
      effect: { coverUrl: { before: 'https://images.example.org/old.jpg', after: '/api/public/assets/product-cover/new.webp' } },
    });
    expect(rows).toEqual([{
      kind: 'change',
      field: 'coverUrl',
      before: { kind: 'text', text: 'https://images.example.org/old.jpg', long: false, breakAnywhere: true },
      after: { kind: 'image', path: '/api/public/assets/product-cover/new.webp', awaitingApproval: null },
    }]);
  });

  it('routes the proposed image of a pending proposal to the owner preview, and keeps the public rule otherwise', () => {
    const digest = 'e'.repeat(64);
    const proposed = `/api/public/assets/product-cover/${digest}.webp`;
    const live = `/api/public/assets/product-cover/${'f'.repeat(64)}.png`;
    const proposal = { input: { coverUrl: proposed }, effect: { coverUrl: { before: live, after: proposed } } };
    expect(proposalRows(proposal, undefined, 'proposal-1')).toEqual([{
      kind: 'change',
      field: 'coverUrl',
      before: { kind: 'image', path: live, awaitingApproval: null },
      after: { kind: 'image', path: proposed, awaitingApproval: { proposalId: 'proposal-1', digest, extension: 'webp' } },
    }]);
    expect(proposalRows(proposal)).toEqual([{
      kind: 'change',
      field: 'coverUrl',
      before: { kind: 'image', path: live, awaitingApproval: null },
      after: { kind: 'image', path: proposed, awaitingApproval: null },
    }]);
    expect(proposalRows({ input: {}, effect: { coverUrl: { before: null, after: 'https://images.example.org/a.png' } } }, undefined, 'proposal-1')[0])
      .toMatchObject({ after: { kind: 'text', text: 'https://images.example.org/a.png' } });
  });

  it('keeps a stock adjustment a delta', () => {
    expect(proposalRows({ input: { productId: 'p1', delta: -3, reason: 'Damaged' }, effect: { onHand: { delta: -3 } } }))
      .toEqual([{ kind: 'delta', field: 'onHand', delta: -3 }]);
    expect(stockAdjustmentProductId({ operation: 'stock.adjust', input: { productId: 'p1' } })).toBe('p1');
    expect(stockAdjustmentProductId({ operation: 'stock.adjust', input: { productId: '$proposal:p1' } })).toBeNull();
  });

  it('shows only the after column for a new record and hides the existence marker', () => {
    const [first] = changeProposalGroupItems;
    if (first === undefined) throw new Error('missing fixture');
    const rows = proposalRows(first);
    expect(rows.some((row) => row.field === 'exists')).toBe(false);
    expect(rows.every((row) => row.kind === 'change' && row.before === null)).toBe(true);
    expect(rows[0]?.field).toBe('title');
  });

  it('names a reference by the step that creates it', () => {
    const references = groupReferences(changeProposalGroupItems);
    const link = changeProposalGroupItems[4];
    if (link === undefined) throw new Error('missing fixture');
    const productIds = proposalRows(link, references).find((row) => row.field === 'productIds');
    expect(productIds).toEqual({
      kind: 'change',
      field: 'productIds',
      before: null,
      after: { kind: 'list', items: [{ kind: 'reference', thing: 'product', position: 1, label: 'Field Guide (print)' }] },
    });
    const price = changeProposalGroupItems[1];
    if (price === undefined) throw new Error('missing fixture');
    expect(proposalTarget(price, references)).toEqual({
      kind: 'reference',
      reference: { thing: 'product', position: 1, label: 'Field Guide (print)' },
    });
  });

  it('formats money with its currency and keeps unknown fields', () => {
    expect(proposalRows({ input: { currency: 'PLN' }, effect: { priceCents: { before: 100, after: 200 }, giftWrap: { before: null, after: { colour: 'red' } } } }))
      .toEqual([
        { kind: 'change', field: 'priceCents', before: { kind: 'money', amountCents: 100, currency: 'PLN' }, after: { kind: 'money', amountCents: 200, currency: 'PLN' } },
        {
          kind: 'change',
          field: 'giftWrap',
          before: { kind: 'empty' },
          after: { kind: 'record', entries: [{ field: 'colour', value: { kind: 'text', text: 'red', long: false, breakAnywhere: true } }] },
        },
      ]);
  });

  it('derives an added file, a new version and a removal from the file lists by id', () => {
    const file = (id: string, lineageId: string, versionNumber: number, latest: boolean) => ({
      id, lineageId, versionNumber, latest, fileName: `${id}.pdf`, contentType: 'application/pdf', sizeBytes: 1024, fingerprint: null, versionNote: null,
    });
    const first = file('file-1', 'file-1', 1, true);
    const added = file('staged-1', 'staged-1', 1, true);
    expect(proposalFileChanges({ effect: { files: { before: [first], after: [first, added] } } }))
      .toEqual({ changes: [{ kind: 'added', file: added }], complete: true });

    const second = file('staged-2', 'file-1', 2, true);
    expect(proposalFileChanges({ effect: { files: { before: [first], after: [{ ...first, latest: false }, second] } } }))
      .toEqual({ changes: [{ kind: 'replaced', file: second, previous: first }], complete: true });

    expect(proposalFileChanges({ effect: { files: { before: [{ ...first, latest: false }, second], after: [first] } } }))
      .toEqual({ changes: [{ kind: 'removed', file: second, current: first }], complete: true });
    expect(proposalFileChanges({ effect: { files: { before: [first], after: [] } } }))
      .toEqual({ changes: [{ kind: 'removed', file: first, current: null }], complete: true });
  });

  it('marks a file change incomplete when another file changed too, and reads nothing from a list it cannot parse', () => {
    const first = { id: 'f', lineageId: 'f', versionNumber: 1, latest: true, fileName: 'f.pdf', contentType: 'application/pdf', sizeBytes: 1, fingerprint: null, versionNote: null };
    const added = { ...first, id: 'g', lineageId: 'g' };
    expect(proposalFileChanges({ effect: { files: { before: [first], after: [{ ...first, fileName: 'renamed.pdf' }, added] } } })?.complete).toBe(false);
    expect(proposalFileChanges({ effect: { files: { before: [first], after: [{ ...first, latest: false }, added] } } })?.complete).toBe(false);
    expect(proposalFileChanges({ effect: { files: { before: [first], after: [first] } } })).toBeNull();
    expect(proposalFileChanges({ effect: { files: { before: 'none', after: [first] } } })).toBeNull();
    expect(proposalFileChanges({ effect: { title: { before: 'a', after: 'b' } } })).toBeNull();
    expect(proposalFileChanges({ effect: { files: { before: null, after: [added] } } })).toEqual({ changes: [{ kind: 'added', file: added }], complete: true });
  });
});
