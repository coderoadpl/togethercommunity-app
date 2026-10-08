import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { SalesLinkEditor } from './SalesLinkEditor.js';
import { sampleBundleProducts, sampleSalesLink } from '../../../test/sales-link-fixtures.js';
import { formatValidityTime, parseValidityTime } from './validity-time.js';

it('saves reordered non-duplicated lines and workspace validity instants', async () => {
  const save = vi.fn();
  renderWithProviders(<SalesLinkEditor salesLink={sampleSalesLink} products={sampleBundleProducts} onSave={save} onCancel={() => undefined} />);
  await userEvent.click(screen.getByRole('button', { name: `${en.salesLinks.moveDown}: 1` }));
  await userEvent.click(screen.getByRole('button', { name: en.salesLinks.save }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ productIds: ['product-2', 'product-1', 'product-3'], listed: false, validFrom: null, validTo: null }));
});

it('does not save an empty bundle', async () => {
  const save = vi.fn();
  renderWithProviders(<SalesLinkEditor salesLink={{ ...sampleSalesLink, productIds: ['product-1'] }} products={sampleBundleProducts} onSave={save} onCancel={() => undefined} />);
  await userEvent.click(screen.getByRole('button', { name: en.common.remove }));
  await userEvent.click(screen.getByRole('button', { name: en.salesLinks.save }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(en.salesLinks.invalid);
});

describe('workspace validity time', () => {
  it('converts winter and summer wall times independently of the browser timezone', () => {
    expect(parseValidityTime('2026-01-10T12:00', 'Europe/Warsaw')).toBe('2026-01-10T11:00:00.000Z');
    expect(parseValidityTime('2026-07-10T12:00', 'Europe/Warsaw')).toBe('2026-07-10T10:00:00.000Z');
    expect(formatValidityTime('2026-07-10T10:00:00.000Z', 'Europe/Warsaw')).toBe('2026-07-10T12:00');
  });
  it('rejects nonexistent daylight saving wall times', () => {
    expect(parseValidityTime('2026-03-29T02:30', 'Europe/Warsaw')).toBeUndefined();
  });
});
