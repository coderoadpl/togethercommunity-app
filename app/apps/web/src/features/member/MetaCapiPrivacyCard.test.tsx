import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, it, vi } from 'vitest';
import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { MetaCapiPrivacyCard } from './MetaCapiPrivacyCard.js';

const day = (value: string) => new Date(value).toLocaleDateString('en');

it('lists order decisions and withdraws a grant, then refreshes the account state', async () => {
  let withdrawnAt: string | null = null;
  const withdraw = vi.fn();
  server.use(
    http.get('/api/me/meta-capi/consents', () => HttpResponse.json({ ok: true, data: { consents: [
      { orderId: 'order-1', consent: 'granted', consentAt: '2026-11-05T10:00:00.000Z', withdrawnAt, productName: 'Course', purchasedAt: '2026-11-05T09:00:00.000Z' },
      { orderId: 'order-2', consent: 'denied', consentAt: '2026-11-04T10:00:00.000Z', withdrawnAt: null, productName: 'Book', purchasedAt: '2026-11-04T09:00:00.000Z' },
    ] } })),
    http.post('/api/me/meta-capi/withdraw', async ({ request }) => {
      withdraw(await request.json());
      withdrawnAt = '2026-11-05T11:00:00.000Z';
      return HttpResponse.json({ ok: true, data: { consent: 'granted', withdrawnAt } });
    }),
  );
  renderWithProviders(<MetaCapiPrivacyCard />);
  expect(await screen.findByText(en.metaCapi.purchase({ product: 'Course', date: day('2026-11-05T09:00:00.000Z') }))).toBeVisible();
  expect(screen.getByText(en.metaCapi.purchase({ product: 'Book', date: day('2026-11-04T09:00:00.000Z') }))).toBeVisible();
  expect(screen.queryByText(en.metaCapi.order({ id: 'order-1' }))).toBeNull();
  const [granted, denied] = screen.getAllByRole('status');
  expect(granted).toHaveTextContent(`${en.metaCapi.rowGranted} · ${day('2026-11-05T10:00:00.000Z')}`);
  expect(denied).toHaveTextContent(`${en.metaCapi.rowDenied} · ${day('2026-11-04T10:00:00.000Z')}`);
  expect(screen.getByText(en.metaCapi.withdrawHint)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: en.metaCapi.withdrawShort }));
  await waitFor(() => expect(screen.getAllByRole('status')[0]).toHaveTextContent(`${en.metaCapi.rowWithdrawn} · ${day('2026-11-05T11:00:00.000Z')}`));
  expect(screen.getAllByRole('status')[0]).toHaveFocus();
  expect(withdraw).toHaveBeenCalledWith({ orderId: 'order-1' });
  expect(screen.queryByRole('button', { name: en.metaCapi.withdrawShort })).toBeNull();
  expect(screen.queryByText(en.metaCapi.withdrawHint)).toBeNull();
});

it('shows the pending label and the error on the tapped row only', async () => {
  let fail: () => void = () => undefined;
  const failed = new Promise<void>((resolve) => { fail = resolve; });
  server.use(
    http.get('/api/me/meta-capi/consents', () => HttpResponse.json({ ok: true, data: { consents: [
      { orderId: 'order-1', consent: 'granted', consentAt: null, withdrawnAt: null, productName: 'Course', purchasedAt: null },
      { orderId: 'order-2', consent: 'granted', consentAt: null, withdrawnAt: null, productName: null, purchasedAt: null },
    ] } })),
    http.post('/api/me/meta-capi/withdraw', async () => {
      await failed;
      return HttpResponse.error();
    }),
  );
  renderWithProviders(<MetaCapiPrivacyCard />);
  expect(await screen.findByText('Course')).toBeVisible();
  expect(screen.getByText(en.metaCapi.order({ id: 'order-2' }))).toBeVisible();
  const [first, second] = screen.getAllByRole('button', { name: en.metaCapi.withdrawShort });
  if (!first || !second) throw new Error('Missing withdraw buttons');
  fireEvent.click(first);
  expect(await screen.findByRole('button', { name: en.metaCapi.withdrawing })).toBeDisabled();
  expect(second).toBeEnabled();
  fail();
  await screen.findByRole('alert');
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  const [firstRow, secondRow] = screen.getAllByTestId('meta-capi-consent-row');
  expect(firstRow).toContainElement(screen.getByRole('alert'));
  expect(secondRow).not.toContainElement(screen.getByRole('alert'));
});

it('shows failures without removing the withdrawal action', async () => {
  server.use(
    http.get('/api/me/meta-capi/consents', () => HttpResponse.json({ ok: true, data: { consents: [
      { orderId: 'order-1', consent: 'granted', consentAt: null, withdrawnAt: null },
    ] } })),
    http.post('/api/me/meta-capi/withdraw', () => HttpResponse.error()),
  );
  renderWithProviders(<MetaCapiPrivacyCard />);
  fireEvent.click(await screen.findByRole('button', { name: en.metaCapi.withdrawShort }));
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.getByRole('button', { name: en.metaCapi.withdrawShort })).toBeEnabled());
});

it('renders nothing for a member without recorded decisions', async () => {
  const requested = vi.fn();
  server.use(http.get('/api/me/meta-capi/consents', () => {
    requested();
    return HttpResponse.json({ ok: true, data: { consents: [] } });
  }));
  const { queryClient } = renderWithProviders(<MetaCapiPrivacyCard />);
  expect(screen.queryByText(en.metaCapi.privacyHeading)).toBeNull();
  await waitFor(() => expect(requested).toHaveBeenCalledOnce());
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  expect(screen.queryByText(en.metaCapi.privacyHeading)).toBeNull();
});

it('shows the card with an error and a working retry when the decisions request fails', async () => {
  let failing = true;
  server.use(http.get('/api/me/meta-capi/consents', () => failing
    ? HttpResponse.json({ ok: false, error: { code: 'internal', message: 'boom' } }, { status: 500 })
    : HttpResponse.json({ ok: true, data: { consents: [
      { orderId: 'order-1', consent: 'granted', consentAt: null, withdrawnAt: null },
    ] } })));
  renderWithProviders(<MetaCapiPrivacyCard />);
  const retry = await screen.findByRole('button', { name: en.common.retry });
  expect(screen.getByText(en.metaCapi.privacyHeading)).toBeVisible();
  failing = false;
  fireEvent.click(retry);
  expect(await screen.findByRole('button', { name: en.metaCapi.withdrawShort })).toBeVisible();
  expect(screen.queryByRole('button', { name: en.common.retry })).toBeNull();
});
