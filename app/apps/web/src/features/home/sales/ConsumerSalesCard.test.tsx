import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { en } from '../../../i18n/en.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { ConsumerSalesCard } from './ConsumerSalesCard.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('ConsumerSalesCard', () => {
  it('defaults to the previous Warsaw month, renders totals and downloads the selected CSV', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T22:00:00Z'));
    const user = userEvent.setup();
    const queries: string[] = [];
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:consumer-sales');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    server.use(http.get('/api/orders/consumer-sales-summary', ({ request }) => {
      const params = new URL(request.url).searchParams;
      queries.push(params.toString());
      if (params.get('format') === 'csv') return new HttpResponse('rate,net_cents\n5,100', { headers: { 'content-type': 'text/csv' } });
      const value = { orderCount: 1, lineCount: 2, netCents: 100, vatCents: 5, grossCents: 105 };
      return HttpResponse.json({ ok: true, data: { from: params.get('from'), to: params.get('to'), timezone: 'Europe/Warsaw', currency: 'PLN', rates: [{ rate: 5, ...value }], totals: value, orderIds: ['order'], orders: [] } });
    }));
    renderWithProviders(<ConsumerSalesCard />);
    expect(screen.getByLabelText(en.sales.consumerSalesFrom)).toHaveValue('2026-09-01');
    expect(screen.getByLabelText(en.sales.consumerSalesTo)).toHaveValue('2026-09-30');
    const table = await screen.findByRole('table', { name: en.sales.consumerSalesTitle });
    expect(within(table).getByText('5%')).toBeInTheDocument();
    expect(within(table).getByText(en.sales.consumerSalesTotal).closest('tr')).toHaveTextContent('PLN 1.05');
    await user.clear(screen.getByLabelText(en.sales.consumerSalesFrom));
    await user.type(screen.getByLabelText(en.sales.consumerSalesFrom), '2026-09-02');
    await waitFor(() => expect(queries).toContain('from=2026-09-02&to=2026-09-30'));
    await user.click(screen.getByRole('button', { name: en.sales.consumerSalesDownload }));
    await waitFor(() => expect(clicked).toHaveBeenCalledOnce());
    expect(queries).toContain('from=2026-09-02&to=2026-09-30&format=csv');
    expect(createUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeUrl).toHaveBeenCalledWith('blob:consumer-sales');
  });
  it('disables the export and shows the localized error when stored line data is incomplete', async () => {
    server.use(http.get('/api/orders/consumer-sales-summary', () => HttpResponse.json({ ok: false, error: { code: 'validation', message: 'Orders have missing stored VAT rates or lines' } }, { status: 400 })));
    renderWithProviders(<ConsumerSalesCard />);
    await waitFor(() => expect(screen.getByRole('button', { name: en.sales.consumerSalesDownload })).toBeDisabled());
    expect(await screen.findByRole('button', { name: en.common.retry })).toBeInTheDocument();
  });
});
