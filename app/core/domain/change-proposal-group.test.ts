import { describe, expect, it } from 'vitest';

import { changeProposalExpiresAt } from './change-proposal.js';
import {
  changeProposalCreatedKind,
  changeProposalGroupExpiresAt,
  changeProposalGroupStatus,
  changeProposalReference,
  checkChangeProposalReferences,
  mapChangeProposalSnapshotStrings,
  resolveChangeProposalReferences,
} from './change-proposal-group.js';

const CREATED = '2026-03-01T10:00:00.000Z';
const earlier = [
  { id: 'item-product', operation: 'product.create' },
  { id: 'item-price', operation: 'price.create' },
  { id: 'item-link', operation: 'sales-link.create' },
  { id: 'item-update', operation: 'product.update' },
];

describe('proposal references', () => {
  it('names the creating proposal', () => {
    expect(changeProposalReference('item-product')).toBe('$proposal:item-product');
    expect(changeProposalCreatedKind('product.create')).toBe('product');
    expect(changeProposalCreatedKind('price.create')).toBe('price');
    expect(changeProposalCreatedKind('sales-link.create')).toBe('sales-link');
    expect(changeProposalCreatedKind('product.update')).toBeNull();
    expect(changeProposalCreatedKind('image.attach-cover')).toBeNull();
  });

  it.each([
    ['price.create', { productId: '$proposal:item-product' }],
    ['price.deactivate', { id: '$proposal:item-price' }],
    ['sales-link.update', { id: '$proposal:item-link', productIds: ['live', '$proposal:item-product'] }],
    ['stock.enable', { productId: 'live-product' }],
  ] as const)('accepts %s with references in its id positions only', (operation, input) => {
    expect(checkChangeProposalReferences(operation, input, earlier)).toEqual({ ok: true, value: undefined });
  });

  it.each([
    ['a reference in a text field', 'product.update', { id: 'live', title: '$proposal:item-product' }, /"title" cannot hold/u],
    ['a reference nested in a list of objects', 'product.create', { accessItems: [{ id: '$proposal:item-product' }] }, /"accessItems.0.id" cannot hold/u],
    ['a key shaped like a list position', 'sales-link.create', { 'productIds.0': '$proposal:item-product', productIds: ['live'] }, /cannot hold/u],
    ['a reference in an operation without id positions', 'settings.update', { name: '$proposal:item-product' }, /cannot hold/u],
    ['a malformed reference', 'product.publish', { id: '$proposal:' }, /not a valid proposal reference/u],
    ['a reference-like prefix', 'product.publish', { id: '$proposalitem-product' }, /not a valid proposal reference/u],
    ['a reference to an unknown item', 'product.publish', { id: '$proposal:item-later' }, /names no earlier proposal/u],
    ['a reference to an item that creates nothing', 'product.publish', { id: '$proposal:item-update' }, /does not create a product/u],
    ['a product reference to a price', 'stock.adjust', { productId: '$proposal:item-price' }, /does not create a product/u],
    ['a price reference to a product', 'price.deactivate', { id: '$proposal:item-product' }, /does not create a price/u],
  ] as const)('refuses %s', (_label, operation, input, message) => {
    const checked = checkChangeProposalReferences(operation, input, earlier);
    expect(checked).toMatchObject({ ok: false, error: { code: 'validation' } });
    if (checked.ok) throw new Error('expected a refusal');
    expect(checked.error.message).toMatch(message);
  });

  it('resolves references only in id positions and fails on one it cannot resolve', () => {
    const created = new Map([['item-product', 'product-7']]);
    const idOf = (proposalId: string) => created.get(proposalId) ?? null;

    expect(resolveChangeProposalReferences('sales-link.create', { title: '$proposal:item-product', productIds: ['live', '$proposal:item-product'] }, idOf))
      .toEqual({ title: '$proposal:item-product', productIds: ['live', 'product-7'] });
    expect(resolveChangeProposalReferences('price.create', { productId: '$proposal:item-other' }, idOf)).toBeNull();
  });

  it('maps every string of a snapshot', () => {
    expect(mapChangeProposalSnapshotStrings({ a: 'x', b: ['x', 1, null, { c: 'x' }], d: true }, (text) => text === 'x' ? 'y' : text))
      .toEqual({ a: 'y', b: ['y', 1, null, { c: 'y' }], d: true });
  });
});

describe('group status and expiry', () => {
  const group = { createdAt: CREATED };
  const item = (status: 'pending' | 'applied' | 'stale' | 'failed' | 'rejected' | 'withdrawn', expiresAt = '2026-03-31T10:00:00.000Z') => ({ status, expiresAt });

  it('expires an empty group 30 days after creation and a filled one with its first item', () => {
    expect(changeProposalGroupExpiresAt(group, [])).toBe(changeProposalExpiresAt(CREATED));
    expect(changeProposalGroupExpiresAt(group, [item('pending', '2026-04-15T10:00:00.000Z'), item('pending', '2026-04-20T10:00:00.000Z')])).toBe('2026-04-15T10:00:00.000Z');
  });

  it.each([
    [[], CREATED, 'open'],
    [[], changeProposalExpiresAt(CREATED), 'expired'],
    [[item('pending'), item('pending')], '2026-03-30T10:00:00.000Z', 'open'],
    [[item('pending'), item('pending')], '2026-03-31T10:00:00.000Z', 'expired'],
    [[item('applied'), item('applied')], '2026-04-30T10:00:00.000Z', 'applied'],
    [[item('stale'), item('failed')], CREATED, 'failed'],
    [[item('stale'), item('stale')], CREATED, 'stale'],
    [[item('rejected')], CREATED, 'rejected'],
    [[item('withdrawn'), item('pending')], CREATED, 'withdrawn'],
  ] as const)('derives the status of %j at %s as %s', (items, now, status) => {
    expect(changeProposalGroupStatus(group, items, now)).toBe(status);
  });
});
