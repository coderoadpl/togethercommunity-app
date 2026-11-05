import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, it, vi } from 'vitest';
import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { MetaCapiPrivacyCard } from './MetaCapiPrivacyCard.js';

it('lists order decisions and withdraws a grant, then refreshes the account state', async () => {
  let withdrawnAt: string | null = null;
  const withdraw = vi.fn();
  server.use(
    http.get('/api/me/meta-capi/consents', () => HttpResponse.json({ ok: true, data: { consents: [
      { orderId: 'order-1', consent: 'granted', consentAt: '2026-11-05T10:00:00.000Z', withdrawnAt },
      { orderId: 'order-2', consent: 'denied', consentAt: '2026-11-05T10:00:00.000Z', withdrawnAt: null },
    ] } })),
    http.post('/api/me/meta-capi/withdraw', async ({ request }) => {
      withdraw(await request.json());
      withdrawnAt = '2026-11-05T11:00:00.000Z';
      return HttpResponse.json({ ok: true, data: { consent: 'granted', withdrawnAt } });
    }),
  );
  renderWithProviders(<MetaCapiPrivacyCard />);
  expect(await screen.findByText(en.metaCapi.order({ id: 'order-1' }))).toBeVisible();
  expect(screen.getByText(en.metaCapi.denied)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: en.metaCapi.withdraw }));
  expect(await screen.findByText(en.metaCapi.withdrawn)).toBeVisible();
  expect(withdraw).toHaveBeenCalledWith({ orderId: 'order-1' });
  expect(screen.queryByRole('button', { name: en.metaCapi.withdraw })).toBeNull();
});

it('shows failures without removing the withdrawal action', async () => {
  server.use(
    http.get('/api/me/meta-capi/consents', () => HttpResponse.json({ ok: true, data: { consents: [
      { orderId: 'order-1', consent: 'granted', consentAt: null, withdrawnAt: null },
    ] } })),
    http.post('/api/me/meta-capi/withdraw', () => HttpResponse.error()),
  );
  renderWithProviders(<MetaCapiPrivacyCard />);
  fireEvent.click(await screen.findByRole('button', { name: en.metaCapi.withdraw }));
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.getByRole('button', { name: en.metaCapi.withdraw })).toBeEnabled());
});
