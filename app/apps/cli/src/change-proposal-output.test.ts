import { describe, expect, it } from 'vitest';

import { changeProposalAppliedLine } from './change-proposal-output.js';

describe('changeProposalAppliedLine', () => {
  it.each([
    ['price.create', 'price-1', 'applied: price price-1'],
    ['price.deactivate', 'price-1', 'applied: price price-1'],
    ['product.create', 'product-1', 'applied: product product-1'],
    ['stock.adjust', 'product-1', 'applied: product product-1'],
    ['sales-link.update', 'link-1', 'applied: sales link link-1'],
    ['settings.update', null, 'applied: settings'],
    ['image.attach', 'image-1', 'applied: image-1'],
    ['product.update', null, 'applied'],
  ] as const)('labels the resource %s applied as it is', (operation, appliedResourceId, line) => {
    expect(changeProposalAppliedLine(operation, appliedResourceId)).toBe(line);
  });
});
