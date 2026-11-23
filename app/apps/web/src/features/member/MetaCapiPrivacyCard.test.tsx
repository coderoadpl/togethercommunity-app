import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, expect, it, vi } from 'vitest';
import { en } from '../../i18n/en.js';
import { LanguageProvider } from '../../i18n/index.js';
import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { MetaCapiPrivacyCard } from './MetaCapiPrivacyCard.js';

const days: Record<string, string> = {
  '2026-11-05T09:00:00.000Z': '5 Nov 2026',
  '2026-11-04T09:00:00.000Z': '4 Nov 2026',
  '2026-11-05T10:00:00.000Z': '5 Nov 2026',
  '2026-11-04T10:00:00.000Z': '4 Nov 2026',
  '2026-11-05T11:00:00.000Z': '5 Nov 2026',
  '2026-01-05T09:00:00.000Z': '5 Jan 2026',
};
const day = (value: string): string => {
  const formatted = days[value];
  if (formatted === undefined) throw new Error(`No expected date for ${value}`);
  return formatted;
};
afterEach(() => window.localStorage.clear());

const rowStatuses = () => screen.getAllByTestId('meta-capi-consent-row').map((row) => within(row).getByRole('status'));

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
  expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
  expect(screen.queryAllByRole('heading', { level: 6 })).toHaveLength(0);
  expect(screen.getByText('Course', { exact: false }).tagName).toBe('P');
  const [granted, denied] = rowStatuses();
  expect(granted).toHaveTextContent(`${en.metaCapi.rowGranted} · ${day('2026-11-05T10:00:00.000Z')}`);
  expect(denied).toHaveTextContent(`${en.metaCapi.rowDenied} · ${day('2026-11-04T10:00:00.000Z')}`);
  expect(screen.getByText(en.metaCapi.withdrawHint)).toBeVisible();
  const course = en.metaCapi.purchase({ product: 'Course', date: day('2026-11-05T09:00:00.000Z') });
  fireEvent.click(screen.getByRole('button', { name: `${en.metaCapi.withdrawShort} ${course}` }));
  await waitFor(() => expect(rowStatuses()[0]).toHaveTextContent(`${en.metaCapi.rowWithdrawn} · ${day('2026-11-05T11:00:00.000Z')}`));
  expect(rowStatuses()[0]).toHaveFocus();
  expect(screen.getByTestId('meta-capi-withdrawn-notice')).toBeEmptyDOMElement();
  expect(withdraw).toHaveBeenCalledWith({ orderId: 'order-1' });
  expect(screen.queryByRole('button', { name: new RegExp(`^${en.metaCapi.withdrawShort}`) })).toBeNull();
  expect(screen.queryByText(en.metaCapi.withdrawHint)).toBeNull();
});

it('formats purchase and decision dates in the member language', async () => {
  window.localStorage.setItem('together-language', 'pl');
  server.use(
    http.get('/api/me/meta-capi/consents', () => HttpResponse.json({ ok: true, data: { consents: [
      { orderId: 'order-1', consent: 'granted', consentAt: '2026-11-05T10:00:00.000Z', withdrawnAt: null, productName: 'Course', purchasedAt: '2026-11-05T09:00:00.000Z' },
    ] } })),
  );
  renderWithProviders(<LanguageProvider><MetaCapiPrivacyCard /></LanguageProvider>);
  expect(await screen.findByText(pl.metaCapi.purchase({ product: 'Course', date: '5 lis 2026' }))).toBeVisible();
  expect(rowStatuses()[0]).toHaveTextContent(`${pl.metaCapi.rowGranted} · 5 lis 2026`);
});

it('announces the withdrawal at card level and focuses it when the refreshed list omits the row', async () => {
  let withdrawn = false;
  const older = { orderId: 'order-old', consent: 'granted', consentAt: '2026-01-05T10:00:00.000Z', withdrawnAt: null, productName: 'Course', purchasedAt: '2026-01-05T09:00:00.000Z' };
  const newer = { orderId: 'order-new', consent: 'granted', consentAt: '2026-11-05T10:00:00.000Z', withdrawnAt: null, productName: 'Book', purchasedAt: '2026-11-05T09:00:00.000Z' };
  server.use(
    http.get('/api/me/meta-capi/consents', () => HttpResponse.json({ ok: true, data: { consents: withdrawn ? [newer] : [newer, older] } })),
    http.post('/api/me/meta-capi/withdraw', () => {
      withdrawn = true;
      return HttpResponse.json({ ok: true, data: { consent: 'granted', withdrawnAt: '2026-11-06T10:00:00.000Z' } });
    }),
  );
  renderWithProviders(<MetaCapiPrivacyCard />);
  const title = en.metaCapi.purchase({ product: 'Course', date: day('2026-01-05T09:00:00.000Z') });
  const [, olderRow] = await screen.findAllByTestId('meta-capi-consent-row');
  if (!olderRow) throw new Error('Missing older row');
  const notice = screen.getByTestId('meta-capi-withdrawn-notice');
  expect(notice).toBeEmptyDOMElement();
  fireEvent.click(within(olderRow).getByRole('button', { name: `${en.metaCapi.withdrawShort} ${title}` }));
  await waitFor(() => expect(screen.getAllByTestId('meta-capi-consent-row')).toHaveLength(1));
  await waitFor(() => expect(notice).toHaveTextContent(en.metaCapi.withdrawnNotice({ title })));
  expect(notice).toHaveAttribute('role', 'status');
  expect(notice).toHaveFocus();
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
  const first = screen.getByRole('button', { name: `${en.metaCapi.withdrawShort} Course` });
  const second = screen.getByRole('button', { name: `${en.metaCapi.withdrawShort} ${en.metaCapi.order({ id: 'order-2' })}` });
  expect(screen.getAllByRole('button', { name: new RegExp(`^${en.metaCapi.withdrawShort}`) })).toEqual([first, second]);
  fireEvent.click(first);
  expect(await screen.findByRole('button', { name: `${en.metaCapi.withdrawing} Course` })).toBeDisabled();
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
  const name = `${en.metaCapi.withdrawShort} ${en.metaCapi.order({ id: 'order-1' })}`;
  fireEvent.click(await screen.findByRole('button', { name }));
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
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
  expect(await screen.findByRole('button', { name: `${en.metaCapi.withdrawShort} ${en.metaCapi.order({ id: 'order-1' })}` })).toBeVisible();
  expect(screen.queryByRole('button', { name: en.common.retry })).toBeNull();
});
