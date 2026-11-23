import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, expect, it, vi } from 'vitest';
import { en } from '../../i18n/en.js';
import { LanguageProvider } from '../../i18n/index.js';
import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { MetaCapiPrivacyCard } from './MetaCapiPrivacyCard.js';

const at = (month: number, date: number, hour = 12): string => new Date(2026, month, date, hour).toISOString();
const day = (value: string, locale = 'en-GB'): string => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));
const nov5Purchase = at(10, 5);
const nov5Decision = at(10, 5, 13);
const nov5Withdrawal = at(10, 5, 14);
const nov4Purchase = at(10, 4);
const nov4Decision = at(10, 4, 13);
const jan5Purchase = at(0, 5);
const jan5Decision = at(0, 5, 13);
afterEach(() => window.localStorage.clear());

const rowStatuses = () => screen.getAllByTestId('meta-capi-consent-row').map((row) => within(row).getByRole('status'));

it('lists order decisions and withdraws a grant, then refreshes the account state', async () => {
  let withdrawnAt: string | null = null;
  const withdraw = vi.fn();
  server.use(
    http.get('/api/me/meta-capi/consents', () => HttpResponse.json({ ok: true, data: { consents: [
      { orderId: 'order-1', consent: 'granted', consentAt: nov5Decision, withdrawnAt, productName: 'Course', purchasedAt: nov5Purchase },
      { orderId: 'order-2', consent: 'denied', consentAt: nov4Decision, withdrawnAt: null, productName: 'Book', purchasedAt: nov4Purchase },
    ] } })),
    http.post('/api/me/meta-capi/withdraw', async ({ request }) => {
      withdraw(await request.json());
      withdrawnAt = nov5Withdrawal;
      return HttpResponse.json({ ok: true, data: { consent: 'granted', withdrawnAt } });
    }),
  );
  renderWithProviders(<MetaCapiPrivacyCard />);
  expect(await screen.findByText(en.metaCapi.purchase({ product: 'Course', date: day(nov5Purchase) }))).toBeVisible();
  expect(screen.getByText(en.metaCapi.purchase({ product: 'Book', date: day(nov4Purchase) }))).toBeVisible();
  expect(screen.queryByText(en.metaCapi.order({ id: 'order-1' }))).toBeNull();
  expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
  expect(screen.queryAllByRole('heading', { level: 6 })).toHaveLength(0);
  expect(screen.getByText('Course', { exact: false }).tagName).toBe('P');
  const [granted, denied] = rowStatuses();
  expect(granted).toHaveTextContent(`${en.metaCapi.rowGranted} · ${day(nov5Decision)}`);
  expect(denied).toHaveTextContent(`${en.metaCapi.rowDenied} · ${day(nov4Decision)}`);
  expect(screen.getByText(en.metaCapi.withdrawHint)).toBeVisible();
  const course = en.metaCapi.purchase({ product: 'Course', date: day(nov5Purchase) });
  fireEvent.click(screen.getByRole('button', { name: `${en.metaCapi.withdrawShort} ${course}` }));
  await waitFor(() => expect(rowStatuses()[0]).toHaveTextContent(`${en.metaCapi.rowWithdrawn} · ${day(nov5Withdrawal)}`));
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
      { orderId: 'order-1', consent: 'granted', consentAt: nov5Decision, withdrawnAt: null, productName: 'Course', purchasedAt: nov5Purchase },
    ] } })),
  );
  renderWithProviders(<LanguageProvider><MetaCapiPrivacyCard /></LanguageProvider>);
  expect(await screen.findByText(pl.metaCapi.purchase({ product: 'Course', date: day(nov5Purchase, 'pl-PL') }))).toBeVisible();
  expect(rowStatuses()[0]).toHaveTextContent(`${pl.metaCapi.rowGranted} · ${day(nov5Decision, 'pl-PL')}`);
});

it('announces the withdrawal at card level and focuses it when the refreshed list omits the row', async () => {
  let withdrawn = false;
  const older = { orderId: 'order-old', consent: 'granted', consentAt: jan5Decision, withdrawnAt: null, productName: 'Course', purchasedAt: jan5Purchase };
  const newer = { orderId: 'order-new', consent: 'granted', consentAt: nov5Decision, withdrawnAt: null, productName: 'Book', purchasedAt: nov5Purchase };
  server.use(
    http.get('/api/me/meta-capi/consents', () => HttpResponse.json({ ok: true, data: { consents: withdrawn ? [newer] : [newer, older] } })),
    http.post('/api/me/meta-capi/withdraw', () => {
      withdrawn = true;
      return HttpResponse.json({ ok: true, data: { consent: 'granted', withdrawnAt: '2026-11-06T10:00:00.000Z' } });
    }),
  );
  renderWithProviders(<MetaCapiPrivacyCard />);
  const title = en.metaCapi.purchase({ product: 'Course', date: day(jan5Purchase) });
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

it.each([
  { dictionary: en, heading: 'Sending purchase data to Meta', prefix: 'Sending purchase data to Meta: ', confirmationPage: /confirmation page/i },
  { dictionary: pl, heading: 'Przesyłanie danych o zakupach do Meta', prefix: 'Przesyłanie danych o zakupie do Meta: ', confirmationPage: /potwierdzenia/i },
])('names the send with one verb in the card heading, statuses and hint', ({ dictionary, heading, prefix, confirmationPage }) => {
  expect(dictionary.metaCapi.privacyHeading).toBe(heading);
  for (const status of [dictionary.metaCapi.granted, dictionary.metaCapi.denied, dictionary.metaCapi.undecided, dictionary.metaCapi.withdrawn]) {
    expect(status.startsWith(prefix)).toBe(true);
  }
  expect(dictionary.metaCapi.withdrawHint).not.toMatch(confirmationPage);
});
