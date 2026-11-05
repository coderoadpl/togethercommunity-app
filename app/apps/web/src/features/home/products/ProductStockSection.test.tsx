import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { productStockView, type ProductStock } from '#core/domain/index.js';

import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { ProductStockSection, productStockSummary } from './ProductStockSection.js';

const stockOf = (onHand: number, reserved: number, lowStockThreshold: number | null = null): ProductStock =>
  productStockView({ productId: 'poster', onHand, reserved, lowStockThreshold, lowStockNotifiedAt: null, updatedAt: `2026-11-05T10:${String(onHand).padStart(2, '0')}:00.000Z` });

const serveStock = (initial: ProductStock | null) => {
  let current = initial;
  const requests: Array<{ path: string; body: unknown }> = [];
  server.use(
    http.get('/api/products/:productId/stock', () => HttpResponse.json({ ok: true, data: { stock: current } })),
    http.post('/api/products/stock/:action', async ({ request, params }) => {
      const body: unknown = await request.json();
      requests.push({ path: String(params['action']), body });
      if (typeof body !== 'object' || body === null) return HttpResponse.json({ ok: false }, { status: 400 });
      if ('onHand' in body && typeof body.onHand === 'number') current = stockOf(body.onHand, 0, 'lowStockThreshold' in body && typeof body.lowStockThreshold === 'number' ? body.lowStockThreshold : null);
      if ('delta' in body && typeof body.delta === 'number' && current !== null) current = stockOf(current.onHand + body.delta, current.reserved, current.lowStockThreshold);
      return current === null
        ? HttpResponse.json({ ok: false, error: { code: 'not_found', message: 'missing' } }, { status: 404 })
        : HttpResponse.json({ ok: true, data: { stock: current } });
    }),
  );
  return requests;
};

describe('ProductStockSection', () => {
  it('enables tracking with the pieces on hand and a low-stock threshold', async () => {
    const requests = serveStock(null);
    renderWithProviders(<ProductStockSection productId="poster" />);

    expect(await screen.findByText(en.products.stockNotTracked)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: en.products.stockTrack }));
    const start = screen.getByRole('button', { name: en.products.stockEnable });
    expect(start).toBeDisabled();
    await userEvent.type(screen.getByTestId('stock-on-hand-input'), '3');
    await userEvent.type(screen.getByTestId('stock-threshold-input'), '1');
    await userEvent.click(start);

    expect(await screen.findByTestId('product-stock-on-hand')).toHaveTextContent('3');
    expect(screen.getByRole('switch', { name: en.products.stockTrack })).toBeDisabled();
    expect(requests).toEqual([{ path: 'enable', body: { productId: 'poster', onHand: 3, lowStockThreshold: 1 } }]);
  });

  it('shows on hand and reserved pieces and adjusts with a signed change and a reason', async () => {
    const requests = serveStock(stockOf(4, 1, 2));
    renderWithProviders(<ProductStockSection productId="poster" />);

    expect(await screen.findByTestId('product-stock-on-hand')).toHaveTextContent('4');
    expect(screen.getByTestId('product-stock-reserved')).toHaveTextContent('1');
    expect(screen.getByTestId('product-stock-available')).toHaveTextContent('3');
    expect(screen.getByTestId('stock-threshold-input')).toHaveValue('2');
    const adjust = screen.getByRole('button', { name: en.products.stockAdjust });
    await userEvent.type(screen.getByTestId('stock-adjust-delta'), '-1');
    expect(adjust).toBeDisabled();
    await userEvent.type(screen.getByTestId('stock-adjust-reason'), 'damaged');
    await userEvent.click(adjust);

    await waitFor(() => expect(screen.getByTestId('product-stock-on-hand')).toHaveTextContent('3'));
    expect(requests).toEqual([{ path: 'adjust', body: { productId: 'poster', delta: -1, reason: 'damaged' } }]);
  });

  it('shows a sold-out product as sold out instead of a zero count', async () => {
    serveStock(stockOf(1, 1));
    renderWithProviders(<ProductStockSection productId="poster" />);
    expect(await screen.findByTestId('product-stock-available')).toHaveTextContent(en.products.stockSoldOut);
  });

  it('clears the threshold when the field is left empty', async () => {
    const requests = serveStock(stockOf(4, 0, 2));
    renderWithProviders(<ProductStockSection productId="poster" />);
    await userEvent.clear(await screen.findByTestId('stock-threshold-input'));
    await userEvent.click(screen.getByRole('button', { name: en.products.stockSaveThreshold }));
    await waitFor(() => expect(requests).toEqual([{ path: 'threshold', body: { productId: 'poster', lowStockThreshold: null } }]));
  });
});

describe('productStockSummary', () => {
  it('summarizes on hand and reserved pieces, flags low stock and names a sold-out product', () => {
    expect(productStockSummary(stockOf(12, 1), en)).toBe('12 · 1 reserved');
    expect(productStockSummary(stockOf(3, 1, 2), en)).toBe('3 · 1 reserved · Low');
    expect(productStockSummary(stockOf(1, 1, 2), en)).toBe(en.products.stockSoldOut);
  });
});
