import { ThemeProvider } from '@mui/material/styles';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { SALES_LINK_TIME_ZONE, type OrderListItem, type OrderStaffRefundView, type StaffRefundPreview } from '#core/domain/index.js';

import { en } from '../../../i18n/en.js';
import { formatDateTime, formatMinorUnitsPrice } from '../../../lib/format.js';
import { renderWithProviders } from '../../../test/render.js';
import { createThemeForMode } from '../../../theme.js';
import { server } from '../../../test/server.js';
import { PanelContextProvider, type PanelContextValue } from '../panel-context.js';
import { OrderDetailPage } from './OrderDetailPage.js';
import { SalesPanel } from './SalesPanel.js';

const messages = en.sales.staffRefund;
const pln = (cents: number) => formatMinorUnitsPrice(cents, 'PLN', 'en').replace(/\s/g, ' ');
const named = (text: string) => (name: string) => name.replace(/\s+/g, ' ') === text;

const shipping = {
  rateId: 'courier', label: 'Courier', amountCents: 1500, vatRatePercent: 23 as const, carrier: 'other' as const,
  pickupPoint: null,
  address: { name: 'Alex Smith', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' },
  phone: null,
};

const paidOrder: OrderListItem = {
  id: 'o1', tenantId: 't1', memberId: 'member-1', productId: 'mug', priceId: null, kind: 'one_time', status: 'paid',
  amountCents: 24900, currency: 'PLN', provider: 'stripe', mode: 'live', providerObjectIds: { paymentIntent: 'pi_1' },
  couponId: null, discountCents: 0, couponCode: null, createdAt: '2026-11-18T13:32:00.000Z', paidAt: '2026-11-18T13:33:00.000Z',
  memberEmail: 'buyer@example.org', memberName: 'Alex Smith', productTitle: 'Ceramic mug',
  lines: [
    { productId: 'mug', name: 'Ceramic mug', productType: 'physical', quantity: 1, grossCents: 8900, netCents: 7236, vatRate: 23, vatCents: 1664, vatExemptionBasis: null, issuedCount: null },
    { productId: 'course', name: 'Pottery basics', productType: 'course', quantity: 1, grossCents: 14500, netCents: 11789, vatRate: 23, vatCents: 2711, vatExemptionBasis: null, issuedCount: null },
  ],
  shipping, fulfilmentStatus: 'to_pack',
};

const preview: StaffRefundPreview = {
  orderId: 'o1', refundable: true, blockedReason: null, paidCents: 24900, refundedCents: 0, remainderCents: 24900, currency: 'PLN',
  mode: 'live', remainderSource: 'provider', remainderWithheld: false, returnableStock: [{ productId: 'mug', quantity: 1 }], onPackingList: true,
  hasShipment: false, hasInvoice: false, cancelsSubscription: false, waitingRefundId: null,
  fullRefundOptions: { restockOffered: true, restockDefault: true, removeFromPackingListOffered: true, removeFromPackingListDefault: true },
};

const staffRefund = (overrides: Partial<OrderStaffRefundView>): OrderStaffRefundView => ({
  id: 'refund-1', kind: 'amount', status: 'succeeded', amountCents: 5000, currency: 'PLN', attempts: 1, nextAttemptAt: null, lastError: null,
  providerRefundStatus: 'succeeded', submittedAt: '2026-11-19T15:40:00.000Z', permissionBlockedAt: null, requestedByUserId: 'user-1', requestedByEmail: 'owner@example.com',
  note: null, restocked: false, removedFromPackingList: false, createdAt: '2026-11-19T15:40:00.000Z', updatedAt: '2026-11-19T15:41:00.000Z',
  ...overrides,
});

const owner: PanelContextValue = { tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: 'owner', memberId: 'm1' }, email: 'owner@example.com', emailVerified: true };

const requestBodySchema = z.object({
  requestKey: z.string(),
  amountCents: z.number().optional(),
  expectedAmountCents: z.number().optional(),
  expectedRemainderCents: z.number(),
  reason: z.string().optional(),
  restock: z.boolean().optional(),
  removeFromPackingList: z.boolean().optional(),
  expectedShipmentState: z.object({ onPackingList: z.boolean(), hasShipmentOrLabel: z.boolean() }).strict(),
}).strict();

type Detail = { order: OrderListItem; staffRefunds?: OrderStaffRefundView[]; refundTotals?: { paidCents: number; refundedCents: number; remainingCents: number; currency: string } };

const serve = (detail: Detail, refundPreview: StaffRefundPreview = preview) => {
  const refunds: z.infer<typeof requestBodySchema>[] = [];
  const calls = { detail: 0, preview: 0, refunds };
  server.use(
    http.get('/api/orders/o1', () => {
      calls.detail += 1;
      return HttpResponse.json({ ok: true, data: {
        invoice: null, refundJob: null, staffRefunds: [],
        refundTotals: { paidCents: detail.order.amountCents, refundedCents: 0, remainingCents: detail.order.amountCents, currency: 'PLN' },
        ...detail,
      } });
    }),
    http.get('/api/orders/o1/refund-preview', () => {
      calls.preview += 1;
      return HttpResponse.json({ ok: true, data: refundPreview });
    }),
  );
  return calls;
};

const acceptRefunds = (calls: ReturnType<typeof serve>, respond?: (attempt: number) => Response | undefined) => {
  server.use(http.post('/api/orders/o1/refunds', async ({ request }) => {
    calls.refunds.push(requestBodySchema.parse(await request.json()));
    const custom = respond?.(calls.refunds.length);
    if (custom !== undefined) return custom;
    return HttpResponse.json({ ok: true, data: { refund: staffRefund({ status: 'pending' }), created: true } });
  }));
};

const renderAt = async (path: string, component: () => ReactElement, context: PanelContextValue = owner) => {
  const rootRoute = createRootRoute();
  const route = createRoute({ getParentRoute: () => rootRoute, path, component });
  const router = createRouter({ routeTree: rootRoute.addChildren([route]), history: createMemoryHistory({ initialEntries: [path.replace('$orderId', 'o1')] }) });
  await router.load();
  return renderWithProviders(<PanelContextProvider value={context}><RouterProvider router={router} /></PanelContextProvider>);
};

const renderDetail = (context: PanelContextValue = owner) => renderAt('/panel/sales/$orderId', () => <OrderDetailPage orderId="o1" />, context);

const studioTheme = createThemeForMode('shadcn');
const inStudioTheme = (page: ReactElement) => () => <ThemeProvider theme={studioTheme}>{page}</ThemeProvider>;

const openDialog = async () => {
  await userEvent.click(await screen.findByRole('button', { name: messages.action }));
  return screen.findByRole('dialog');
};

beforeEach(() => {
  server.use(http.get('/api/download-copies', () => HttpResponse.json({ ok: true, data: { copies: [] } })));
});

describe('staff refund action', () => {
  it.each(['owner', 'admin'] as const)('offers the refund to an %s when the preview finds something to refund', async (staffRole) => {
    const calls = serve({ order: paidOrder });
    await renderDetail({ ...owner, tenant: { ...owner.tenant, staffRole } });
    expect(await screen.findByRole('button', { name: messages.action })).toBeEnabled();
    expect(calls.preview).toBe(1);
    expect(within(screen.getByTestId('order-payment')).getByText(pln(24900))).toBeVisible();
  });

  it.each([
    { name: 'a viewer without a staff role', context: { ...owner, tenant: { ...owner.tenant, staffRole: null } } },
    { name: 'staff with an unverified e-mail', context: { ...owner, emailVerified: false } },
    { name: 'an impersonating operator', context: { ...owner, impersonating: true } },
  ])('never asks for the preview nor shows the action to $name', async ({ context }) => {
    const calls = serve({ order: paidOrder });
    await renderDetail(context);
    expect(await screen.findByTestId('order-payment')).toBeVisible();
    expect(screen.queryByRole('button', { name: messages.action })).toBeNull();
    expect(calls.preview).toBe(0);
  });

  it('does not offer the refund for an order paid outside Stripe', async () => {
    const calls = serve({ order: { ...paidOrder, provider: 'simulated', providerObjectIds: {} } });
    await renderDetail();
    expect(await screen.findByTestId('order-payment')).toBeVisible();
    expect(screen.queryByRole('button', { name: messages.action })).toBeNull();
    expect(calls.preview).toBe(0);
  });

  it('keeps the action disabled with the reason while another refund waits for Stripe', async () => {
    serve(
      { order: { ...paidOrder, status: 'partially_refunded' }, staffRefunds: [staffRefund({ status: 'running', amountCents: 4900 })], refundTotals: { paidCents: 24900, refundedCents: 4900, remainingCents: 20000, currency: 'PLN' } },
      { ...preview, refundable: false, blockedReason: 'Another refund of this order is still waiting to reach the payment provider', waitingRefundId: 'refund-1', remainderCents: 20000, refundedCents: 4900 },
    );
    await renderDetail();
    expect(await screen.findByRole('button', { name: messages.action })).toBeDisabled();
    expect(screen.getByText(messages.waitingBlocksAction)).toBeVisible();
    const payment = screen.getByTestId('order-payment');
    expect(within(payment).getByText(`−${pln(4900)}`)).toBeVisible();
    expect(within(payment).getByText(messages.inProgress({ amount: pln(4900) }))).toBeVisible();
    expect(within(payment).getByText(pln(20000))).toBeVisible();
  });
});

describe('payment card totals', () => {
  it('shows the refund the provider no longer holds as still to refund, although the platform marked the order refunded', async () => {
    serve(
      { order: { ...paidOrder, status: 'refunded' }, staffRefunds: [staffRefund({ kind: 'remainder', status: 'failed', amountCents: 24900 })], refundTotals: { paidCents: 24900, refundedCents: 24900, remainingCents: 0, currency: 'PLN' } },
      { ...preview, refundedCents: 0, remainderCents: 24900 },
    );
    await renderDetail();
    expect(await screen.findByRole('button', { name: messages.action })).toBeEnabled();
    const payment = screen.getByTestId('order-payment');
    expect(within(payment).queryByText(messages.fullyRefunded)).toBeNull();
    expect(within(payment).queryByText(`−${pln(24900)}`)).toBeNull();
    expect(within(payment).getAllByText(pln(24900)).length).toBeGreaterThan(0);
    expect(within(payment).queryByText(messages.paymentPlatformTotals)).toBeNull();
  });

  it('counts a refund made in the Stripe Dashboard that the platform never recorded', async () => {
    serve({ order: { ...paidOrder, status: 'partially_refunded' } }, { ...preview, refundedCents: 5000, remainderCents: 19900 });
    await renderDetail();
    expect(await screen.findByRole('button', { name: messages.action })).toBeEnabled();
    const payment = screen.getByTestId('order-payment');
    expect(within(payment).getByText(`−${pln(5000)}`)).toBeVisible();
    expect(within(payment).getByText(pln(19900))).toBeVisible();
  });

  it('says why nothing more can be refunded on an order a dispute marked refunded, without claiming the money was refunded', async () => {
    serve(
      { order: { ...paidOrder, status: 'refunded' }, refundTotals: { paidCents: 24900, refundedCents: 24900, remainingCents: 0, currency: 'PLN' } },
      { ...preview, refundable: false, blockedReason: 'The order is marked refunded although its refunds do not cover the payment', refundedCents: 0, remainderCents: 0, remainderWithheld: true },
    );
    await renderDetail();
    const payment = await screen.findByTestId('order-payment');
    expect(await within(payment).findByTestId('order-payment-withheld')).toHaveTextContent(messages.remainderWithheld);
    expect(within(payment).queryByText(messages.fullyRefunded)).toBeNull();
    expect(within(payment).queryByText(`−${pln(24900)}`)).toBeNull();
    expect(screen.queryByRole('button', { name: messages.action })).toBeNull();
  });

  it('lists a refund blocked by the missing permission beside the provider\'s refunded total instead of inside it', async () => {
    serve(
      { order: { ...paidOrder, status: 'partially_refunded' }, staffRefunds: [staffRefund({ id: 'r-blocked', status: 'blocked_permission', amountCents: 1000, permissionBlockedAt: '2026-11-22T07:05:00.000Z' })] },
      { ...preview, refundable: false, waitingRefundId: 'r-blocked', refundedCents: 5000, remainderCents: 18900 },
    );
    await renderDetail();
    const payment = await screen.findByTestId('order-payment');
    expect(await within(payment).findByText(`−${pln(5000)}`)).toBeVisible();
    expect(within(payment).getByText(messages.requestedRefund)).toBeVisible();
    expect(within(payment).getByText(`−${pln(1000)}`)).toBeVisible();
    expect(within(payment).getByText(pln(18900))).toBeVisible();
  });

  it('blames the failed refund check, not Stripe\'s refund list, when the preview request itself fails', async () => {
    serve({ order: { ...paidOrder, status: 'partially_refunded' }, refundTotals: { paidCents: 24900, refundedCents: 4900, remainingCents: 20000, currency: 'PLN' } });
    server.use(http.get('/api/orders/o1/refund-preview', () => HttpResponse.json({ ok: false, error: { code: 'rate_limited', message: 'Too many requests' } }, { status: 429 })));
    await renderDetail();
    const payment = await screen.findByTestId('order-payment');
    expect(await within(payment).findByText(messages.paymentPreviewFailedTotals)).toBeVisible();
    expect(within(payment).queryByText(messages.paymentPlatformTotals)).toBeNull();
  });

  it('labels the totals as the platform\'s records when the provider\'s refund list could not be read', async () => {
    serve(
      { order: { ...paidOrder, status: 'partially_refunded' }, refundTotals: { paidCents: 24900, refundedCents: 4900, remainingCents: 20000, currency: 'PLN' } },
      { ...preview, remainderSource: 'platform', refundedCents: 4900, remainderCents: 20000 },
    );
    await renderDetail();
    expect(await screen.findByRole('button', { name: messages.action })).toBeEnabled();
    const payment = screen.getByTestId('order-payment');
    expect(within(payment).getByText(messages.paymentPlatformTotals)).toBeVisible();
    expect(within(payment).getByText(pln(20000))).toBeVisible();
  });
});

describe('staff refund dialog', () => {
  it('requests a full refund with the default stock and packing choices and refreshes the order', async () => {
    const calls = serve({ order: paidOrder });
    acceptRefunds(calls);
    await renderDetail();
    const dialog = await openDialog();

    expect(within(dialog).getByLabelText(messages.amountLabel)).toHaveValue('249.00');
    expect(within(dialog).getByLabelText(messages.amountLabel)).toHaveAttribute('readonly');
    expect(within(dialog).getByRole('checkbox', { name: new RegExp(messages.restock) })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: new RegExp(messages.removeFromPackingList) })).toBeChecked();
    const consequences = within(dialog).getByTestId('staff-refund-consequences');
    expect(within(consequences).getByText(messages.consequenceProvider({ amount: pln(24900) }))).toBeVisible();
    expect(within(consequences).getByText(messages.consequenceEmail({ buyer: 'Alex Smith' }))).toBeVisible();
    expect(within(consequences).getByText(messages.consequenceRestockAndRemove({ units: 'Ceramic mug × 1' }))).toBeVisible();
    expect(within(consequences).queryByText(messages.consequenceRestock({ units: 'Ceramic mug × 1' }))).toBeNull();
    expect(within(consequences).getByText(messages.consequenceAccessEnds)).toBeVisible();

    await userEvent.type(within(dialog).getByLabelText(messages.reasonLabel), '  The buyer cancelled before shipping  ');
    const submit = within(dialog).getByRole('button', { name: named(messages.submit({ amount: pln(24900) })) });
    expect(submit).toHaveClass('MuiButton-contained', 'MuiButton-colorPrimary');
    await userEvent.click(submit);

    await waitFor(() => expect(calls.refunds).toHaveLength(1));
    expect(calls.refunds[0]).toEqual({ requestKey: expect.any(String), expectedAmountCents: 24900, expectedRemainderCents: 24900, reason: 'The buyer cancelled before shipping', restock: true, removeFromPackingList: true, expectedShipmentState: { onPackingList: true, hasShipmentOrLabel: false } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(calls.detail).toBeGreaterThan(1));
  });

  it('keeps the order off the packing list while goods return to stock and sends the unticked choices of a full refund', async () => {
    const calls = serve({ order: paidOrder });
    acceptRefunds(calls);
    await renderDetail();
    const dialog = await openDialog();
    const removeBox = () => within(dialog).getByRole('checkbox', { name: new RegExp(messages.removeFromPackingList) });
    expect(removeBox()).toBeDisabled();
    expect(within(dialog).getByText(messages.removeFromPackingListWithRestock)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: new RegExp(messages.restock) }));
    expect(removeBox()).toBeEnabled();
    expect(within(dialog).getByText(messages.removeFromPackingListHint)).toBeVisible();
    await userEvent.click(removeBox());
    expect(within(within(dialog).getByTestId('staff-refund-consequences')).getByText(messages.consequenceStaysOnPackingList)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: new RegExp(messages.restock) }));
    expect(removeBox()).toBeChecked();
    expect(removeBox()).toBeDisabled();
    expect(within(within(dialog).getByTestId('staff-refund-consequences')).getByText(messages.consequenceRestockAndRemove({ units: 'Ceramic mug × 1' }))).toBeVisible();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: new RegExp(messages.restock) }));
    expect(removeBox()).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: named(messages.submit({ amount: pln(24900) })) }));
    await waitFor(() => expect(calls.refunds).toHaveLength(1));
    expect(calls.refunds[0]).toEqual({ requestKey: expect.any(String), expectedAmountCents: 24900, expectedRemainderCents: 24900, restock: false, removeFromPackingList: false, expectedShipmentState: { onPackingList: true, hasShipmentOrLabel: false } });
  });

  it('requests a partial refund of the typed amount that keeps stock and packing as they are even if the remainder shrank meanwhile', async () => {
    const calls = serve({ order: paidOrder });
    acceptRefunds(calls);
    await renderDetail();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('switch', { name: new RegExp(messages.partialSwitch) }));
    const amount = within(dialog).getByLabelText(messages.amountLabel);
    await userEvent.clear(amount);
    await userEvent.type(amount, '50,5');
    expect(within(dialog).getByText(messages.amountPartialHelp({ remainder: pln(24900), paid: pln(24900) }))).toBeVisible();
    expect(within(dialog).getByTestId('staff-refund-partial-info')).toBeVisible();
    expect(within(dialog).getByText(messages.consequenceStatusPartial)).toBeVisible();
    expect(within(dialog).getByText(messages.consequenceAccessStays)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: named(messages.submit({ amount: pln(5050) })) }));
    await waitFor(() => expect(calls.refunds).toHaveLength(1));
    expect(calls.refunds[0]).toEqual({ requestKey: expect.any(String), amountCents: 5050, expectedRemainderCents: 24900, restock: false, removeFromPackingList: false, expectedShipmentState: { onPackingList: true, hasShipmentOrLabel: false } });
  });

  it.each([
    { typed: '300', message: messages.amountTooHigh({ remainder: pln(24900) }), button: messages.submit({ amount: pln(30000) }) },
    { typed: '0', message: messages.amountNotPositive({ remainder: pln(24900) }), button: messages.submitWithoutAmount },
    { typed: '1.234', message: messages.amountInvalid({ decimals: 2, remainder: pln(24900) }), button: messages.submitWithoutAmount },
  ])('refuses the partial amount $typed with a message naming the remainder', async ({ typed, message, button }) => {
    const calls = serve({ order: paidOrder });
    acceptRefunds(calls);
    await renderDetail();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('switch', { name: new RegExp(messages.partialSwitch) }));
    const amount = within(dialog).getByLabelText(messages.amountLabel);
    await userEvent.clear(amount);
    await userEvent.type(amount, typed);
    expect(within(dialog).getByText(message)).toBeVisible();
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByRole('button', { name: named(button) })).toBeDisabled();
    const consequences = within(dialog).getByTestId('staff-refund-consequences');
    expect(within(consequences).getByText(messages.consequenceProviderCap({ remainder: pln(24900) }))).toBeVisible();
    expect(within(consequences).queryByText(messages.consequenceProvider({ amount: pln(30000) }))).toBeNull();
    expect(calls.refunds).toHaveLength(0);
  });

  it('says access ends when the partial switch refunds the whole remainder, keeping stock and packing as they are', async () => {
    const calls = serve({ order: paidOrder });
    acceptRefunds(calls);
    await renderDetail();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('switch', { name: new RegExp(messages.partialSwitch) }));
    const amount = within(dialog).getByLabelText(messages.amountLabel);
    await userEvent.clear(amount);
    await userEvent.type(amount, '249');
    const consequences = within(dialog).getByTestId('staff-refund-consequences');
    expect(within(consequences).getAllByText(messages.consequenceAccessEnds)).toHaveLength(2);
    expect(within(consequences).queryByText(messages.consequenceAccessStays)).toBeNull();
    expect(within(consequences).getAllByText(messages.consequenceStatusFull)).toHaveLength(2);
    const info = within(dialog).getByTestId('staff-refund-partial-info');
    expect(info).toHaveTextContent(messages.partialFullInfoTitle);
    expect(info).toHaveTextContent(messages.partialFullInfoBody);
    await userEvent.click(within(dialog).getByRole('button', { name: named(messages.submit({ amount: pln(24900) })) }));
    await waitFor(() => expect(calls.refunds).toHaveLength(1));
    expect(calls.refunds[0]).toEqual({ requestKey: expect.any(String), amountCents: 24900, expectedRemainderCents: 24900, restock: false, removeFromPackingList: false, expectedShipmentState: { onPackingList: true, hasShipmentOrLabel: false } });
  });

  it('reuses the request key of the dialog when a failed request is retried and takes a new one on the next opening', async () => {
    const calls = serve({ order: paidOrder });
    acceptRefunds(calls, (attempt) => attempt === 1 ? HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Lost' } }, { status: 500 }) : undefined);
    await renderDetail();
    let dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: named(messages.submit({ amount: pln(24900) })) }));
    expect(await within(dialog).findByTestId('staff-refund-error')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: named(messages.submit({ amount: pln(24900) })) }));
    await waitFor(() => expect(calls.refunds).toHaveLength(2));
    expect(calls.refunds[1]?.requestKey).toBe(calls.refunds[0]?.requestKey);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: named(messages.submit({ amount: pln(24900) })) }));
    await waitFor(() => expect(calls.refunds).toHaveLength(3));
    expect(calls.refunds[2]?.requestKey).not.toBe(calls.refunds[0]?.requestKey);
  });

  it('disables the primary button while the request is in flight so a double click sends one request', async () => {
    const calls = serve({ order: paidOrder });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post('/api/orders/o1/refunds', async ({ request }) => {
      calls.refunds.push(requestBodySchema.parse(await request.json()));
      await gate;
      return HttpResponse.json({ ok: true, data: { refund: staffRefund({ status: 'pending' }), created: true } });
    }));
    await renderDetail();
    const dialog = await openDialog();
    await userEvent.dblClick(within(dialog).getByRole('button', { name: named(messages.submit({ amount: pln(24900) })) }));
    expect(await within(dialog).findByRole('button', { name: named(messages.submitting) })).toBeDisabled();
    expect(within(dialog).getByRole('switch', { name: new RegExp(messages.partialSwitch) })).toBeDisabled();
    expect(within(dialog).getByLabelText(messages.amountLabel)).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: new RegExp(messages.restock) })).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: new RegExp(messages.removeFromPackingList) })).toBeDisabled();
    expect(within(dialog).getByLabelText(messages.reasonLabel)).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: named(messages.submitting) })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.refunds).toHaveLength(1);
  });

  it.each([
    { code: 'rate_limited', status: 429, details: undefined, shown: messages.errorRateLimited },
    { code: 'validation', status: 400, details: { remainderCents: 10000 }, shown: messages.amountTooHigh({ remainder: pln(10000) }) },
  ])('shows a $code refusal inside the dialog and lets the refund be sent again', async ({ code, status, details, shown }) => {
    const calls = serve({ order: paidOrder });
    acceptRefunds(calls, () => HttpResponse.json({ ok: false, error: { code, message: 'Refused', ...(details === undefined ? {} : { details }) } }, { status }));
    await renderDetail();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: named(messages.submit({ amount: pln(24900) })) }));
    expect(await within(dialog).findByTestId('staff-refund-error')).toHaveTextContent(shown);
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(within(dialog).getByTestId('staff-refund-submit')).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: en.common.cancel })).toBeEnabled();
  });

  it('shows a waiting-refund refusal with the refund button disabled and a close button until the request changes', async () => {
    const calls = serve({ order: paidOrder });
    acceptRefunds(calls, () => HttpResponse.json({ ok: false, error: { code: 'conflict', message: 'Refused', details: { waitingRefund: true } } }, { status: 409 }));
    await renderDetail();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: named(messages.submit({ amount: pln(24900) })) }));
    expect(await within(dialog).findByTestId('staff-refund-error')).toHaveTextContent(messages.errorConflict);
    expect(within(dialog).getByTestId('staff-refund-submit')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: en.common.close })).toBeEnabled();
    expect(within(dialog).queryByRole('button', { name: en.common.cancel })).toBeNull();

    await userEvent.click(within(dialog).getByTestId('staff-refund-partial'));
    expect(within(dialog).queryByTestId('staff-refund-error')).toBeNull();
    expect(within(dialog).getByTestId('staff-refund-submit')).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: en.common.cancel })).toBeEnabled();
    expect(calls.refunds).toHaveLength(1);
  });

  it('shows a localized refusal for another conflict that retrying cannot help, with the refund button disabled', async () => {
    const calls = serve({ order: paidOrder });
    acceptRefunds(calls, () => HttpResponse.json({ ok: false, error: { code: 'conflict', message: 'Nothing is left to refund on this order' } }, { status: 409 }));
    await renderDetail();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: named(messages.submit({ amount: pln(24900) })) }));
    expect(await within(dialog).findByTestId('staff-refund-error')).toHaveTextContent(messages.errorRefused);
    expect(within(dialog).getByTestId('staff-refund-submit')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: en.common.close })).toBeEnabled();
  });

  it('shows the new remainder after a refusal says it changed and sends the refund again only for that remainder', async () => {
    const calls = serve({ order: paidOrder });
    server.use(http.get('/api/orders/o1/refund-preview', () => {
      calls.preview += 1;
      return HttpResponse.json({ ok: true, data: calls.preview === 1 ? preview : { ...preview, refundedCents: 5000, remainderCents: 19900 } });
    }));
    acceptRefunds(calls, (attempt) => attempt === 1
      ? HttpResponse.json({ ok: false, error: { code: 'conflict', message: 'The refundable remainder is now 199.00 PLN', details: { remainderCents: 19900 } } }, { status: 409 })
      : undefined);
    await renderDetail();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: named(messages.submit({ amount: pln(24900) })) }));
    expect(await within(dialog).findByTestId('staff-refund-error')).toHaveTextContent(messages.errorRemainderChanged({ remainder: pln(19900) }));
    const resend = await within(dialog).findByRole('button', { name: named(messages.submit({ amount: pln(19900) })) });
    expect(resend).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: en.common.cancel })).toBeEnabled();

    await userEvent.click(resend);
    await waitFor(() => expect(calls.refunds).toHaveLength(2));
    expect(calls.refunds.map((body) => body.expectedAmountCents)).toStrictEqual([24900, 19900]);
    expect(calls.refunds[1]?.requestKey).toBe(calls.refunds[0]?.requestKey);
  });

  it('refuses a typed partial amount once the remainder changed under it, shows the new remainder and sends the refund again only for that remainder', async () => {
    const calls = serve({ order: paidOrder });
    server.use(http.get('/api/orders/o1/refund-preview', () => {
      calls.preview += 1;
      return HttpResponse.json({ ok: true, data: calls.preview === 1 ? preview : { ...preview, refundedCents: 19850, remainderCents: 5050 } });
    }));
    acceptRefunds(calls, (attempt) => attempt === 1
      ? HttpResponse.json({ ok: false, error: { code: 'conflict', message: 'The refundable remainder is now 50.50 PLN', details: { remainderCents: 5050 } } }, { status: 409 })
      : undefined);
    await renderDetail();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('switch', { name: new RegExp(messages.partialSwitch) }));
    const amount = within(dialog).getByLabelText(messages.amountLabel);
    await userEvent.clear(amount);
    await userEvent.type(amount, '50,5');
    await userEvent.click(within(dialog).getByRole('button', { name: named(messages.submit({ amount: pln(5050) })) }));
    expect(await within(dialog).findByTestId('staff-refund-error')).toHaveTextContent(messages.errorRemainderChanged({ remainder: pln(5050) }));
    await waitFor(() => expect(within(dialog).queryByText(messages.consequenceAccessStays)).toBeNull());

    await userEvent.click(within(dialog).getByRole('button', { name: named(messages.submit({ amount: pln(5050) })) }));
    await waitFor(() => expect(calls.refunds).toHaveLength(2));
    expect(calls.refunds.map((body) => [body.amountCents, body.expectedRemainderCents])).toStrictEqual([[5050, 24900], [5050, 5050]]);
  });

  it('reloads the refund after a label was bought since it was opened, shows the new choices and confirms them for the new state', async () => {
    const calls = serve({ order: paidOrder });
    const labelled: StaffRefundPreview = {
      ...preview, hasShipment: true, fullRefundOptions: { ...preview.fullRefundOptions, restockDefault: false, removeFromPackingListDefault: false },
    };
    server.use(http.get('/api/orders/o1/refund-preview', () => {
      calls.preview += 1;
      return HttpResponse.json({ ok: true, data: calls.preview === 1 ? preview : labelled });
    }));
    acceptRefunds(calls, (attempt) => attempt === 1
      ? HttpResponse.json({ ok: false, error: { code: 'conflict', message: 'Changed', details: { shipmentState: { onPackingList: true, hasShipmentOrLabel: true } } } }, { status: 409 })
      : undefined);
    await renderDetail();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: named(messages.submit({ amount: pln(24900) })) }));

    expect(await within(dialog).findByTestId('staff-refund-error')).toHaveTextContent(messages.errorShipmentChanged);
    expect(await within(dialog).findByText(messages.shippedWarningTitle)).toBeVisible();
    expect(within(dialog).getByRole('checkbox', { name: new RegExp(messages.restock) })).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: new RegExp(messages.removeFromPackingList) })).not.toBeChecked();
    const resend = within(dialog).getByRole('button', { name: named(messages.submit({ amount: pln(24900) })) });
    expect(resend).toBeEnabled();

    await userEvent.click(resend);
    await waitFor(() => expect(calls.refunds).toHaveLength(2));
    expect(calls.refunds.map((body) => [body.expectedShipmentState, body.restock, body.removeFromPackingList])).toStrictEqual([
      [{ onPackingList: true, hasShipmentOrLabel: false }, true, true],
      [{ onPackingList: true, hasShipmentOrLabel: true }, false, false],
    ]);
    expect(calls.refunds[1]?.requestKey).toBe(calls.refunds[0]?.requestKey);
  });

  it('says a full refund of the latest invoice of a subscription also cancels the subscription, and a partial one does not', async () => {
    serve({ order: { ...paidOrder, kind: 'recurring' } }, { ...preview, cancelsSubscription: true });
    await renderDetail();
    const dialog = await openDialog();
    const consequences = within(dialog).getByTestId('staff-refund-consequences');
    expect(within(consequences).getAllByText(messages.consequenceSubscriptionCancelled)).toHaveLength(2);

    await userEvent.click(within(dialog).getByRole('switch', { name: new RegExp(messages.partialSwitch) }));
    const amount = within(dialog).getByLabelText(messages.amountLabel);
    await userEvent.clear(amount);
    await userEvent.type(amount, '10');
    expect(within(consequences).getAllByText(messages.consequenceSubscriptionCancelled)).toHaveLength(1);
    await userEvent.clear(amount);
    await userEvent.type(amount, '249');
    expect(within(consequences).getAllByText(messages.consequenceSubscriptionCancelled)).toHaveLength(2);
  });

  it('says access ends unless another purchase keeps it', async () => {
    serve({ order: paidOrder });
    await renderDetail();
    const dialog = await openDialog();
    expect(messages.consequenceAccessEnds).toContain('unless another purchase keeps it');
    expect(within(within(dialog).getByTestId('staff-refund-consequences')).getByText(messages.consequenceAccessEnds)).toBeVisible();
    expect(within(within(dialog).getByTestId('staff-refund-consequences')).queryByText(messages.consequenceSubscriptionCancelled)).toBeNull();
  });

  it('keeps the refusal outside the scrolling content, right above the buttons', async () => {
    const calls = serve({ order: paidOrder });
    acceptRefunds(calls, () => HttpResponse.json({ ok: false, error: { code: 'conflict', message: 'Refused' } }, { status: 409 }));
    await renderDetail();
    const dialog = await openDialog();
    const submit = within(dialog).getByTestId('staff-refund-submit');
    await userEvent.click(submit);
    const error = await within(dialog).findByTestId('staff-refund-error');
    expect(error.closest('.MuiDialogContent-root')).toBeNull();
    expect(error.nextElementSibling).toContainElement(submit);
  });

  describe('footer order', () => {
    const stubViewport = (phone: boolean) => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: phone && query.includes('max-width'),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }));
    };
    afterEach(() => { vi.unstubAllGlobals(); });

    it.each([
      { width: 'a phone', phone: true, order: ['submit', 'cancel', 'note'] },
      { width: 'a wider screen', phone: false, order: ['note', 'cancel', 'submit'] },
    ])('puts the footer in reading and focus order on $width', async ({ phone, order }) => {
      stubViewport(phone);
      serve({ order: paidOrder });
      await renderDetail();
      const dialog = await openDialog();
      const submit = within(dialog).getByTestId('staff-refund-submit');
      const footer = Array.from(submit.parentElement?.children ?? []).map((child) => {
        if (child === submit) return 'submit';
        if (child.textContent === en.common.cancel) return 'cancel';
        return child.textContent === messages.footerFinal ? 'note' : 'other';
      });
      expect(footer).toStrictEqual(order);
    });
  });

  it('hides the stock option of a test-mode order that has no stock to return and says no e-mail is sent', async () => {
    const calls = serve({ order: { ...paidOrder, mode: 'test' } }, { ...preview, mode: 'test', returnableStock: [] });
    acceptRefunds(calls);
    await renderDetail();
    const dialog = await openDialog();
    expect(within(dialog).queryByRole('checkbox', { name: new RegExp(messages.restock) })).toBeNull();
    expect(within(dialog).getByText(messages.modeTest)).toBeVisible();
    const consequences = within(dialog).getByTestId('staff-refund-consequences');
    expect(within(consequences).getByText(messages.consequenceTestMode)).toBeVisible();
    expect(within(consequences).queryByText(messages.consequenceEmail({ buyer: 'Alex Smith' }))).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: named(messages.submit({ amount: pln(24900) })) }));
    await waitFor(() => expect(calls.refunds).toHaveLength(1));
    expect(calls.refunds[0]).toEqual({ requestKey: expect.any(String), expectedAmountCents: 24900, expectedRemainderCents: 24900, restock: false, removeFromPackingList: true, expectedShipmentState: { onPackingList: true, hasShipmentOrLabel: false } });
  });

  it('warns about a shipment and offers the packing option disabled with its reason', async () => {
    serve({ order: { ...paidOrder, fulfilmentStatus: 'shipped' } }, {
      ...preview, onPackingList: false, hasShipment: true, hasInvoice: true,
      fullRefundOptions: { restockOffered: true, restockDefault: false, removeFromPackingListOffered: false, removeFromPackingListDefault: false },
    });
    await renderDetail();
    const dialog = await openDialog();
    expect(within(dialog).getByText(messages.shippedWarningTitle)).toBeVisible();
    expect(within(dialog).getByRole('checkbox', { name: new RegExp(messages.restock) })).not.toBeChecked();
    expect(within(dialog).queryByRole('checkbox', { name: new RegExp(messages.removeFromPackingList) })).toBeNull();
    const consequences = within(dialog).getByTestId('staff-refund-consequences');
    expect(within(consequences).getByText(messages.consequenceLabel)).toBeVisible();
    expect(within(consequences).getByText(messages.consequenceInvoice)).toBeVisible();
  });
});

describe('staff refund history and ship anyway', () => {
  it('lists each refund with its amount, requester, staff note and state', async () => {
    serve({
      order: { ...paidOrder, status: 'partially_refunded' },
      staffRefunds: [
        staffRefund({ id: 'r-blocked', status: 'blocked_permission', amountCents: 1000, attempts: 2, nextAttemptAt: '2026-11-22T09:05:00.000Z', permissionBlockedAt: '2026-11-22T07:05:00.000Z' }),
        staffRefund({ id: 'r-running', status: 'running', amountCents: 4900, note: 'Late delivery discount' }),
        staffRefund({ id: 'r-failed', status: 'failed', amountCents: 700 }),
        staffRefund({ id: 'r-done', status: 'succeeded', amountCents: 5000, restocked: true }),
      ],
      refundTotals: { paidCents: 24900, refundedCents: 10900, remainingCents: 14000, currency: 'PLN' },
    }, { ...preview, refundable: false, waitingRefundId: 'r-blocked' });
    await renderDetail();

    const history = await screen.findByTestId('order-staff-refunds');
    expect(within(history).getByText(messages.historyCount({ count: 4 }))).toBeVisible();
    const running = within(history).getByTestId('order-staff-refund-r-running');
    expect(within(running).getByText(pln(4900))).toBeVisible();
    expect(within(running).getByText(/requested by owner@example\.com/)).toBeVisible();
    expect(within(running).getByText('Late delivery discount')).toBeVisible();
    expect(within(running).getByTestId('order-staff-refund-state')).toHaveTextContent(messages.states.running);
    expect(within(running).getByText(messages.waitingForStripe)).toBeVisible();

    const blocked = within(history).getByTestId('order-staff-refund-r-blocked');
    expect(within(blocked).getByTestId('order-staff-refund-state')).toHaveTextContent(messages.states.blocked_permission);
    expect(within(blocked).getByText(messages.blockedTitle)).toBeVisible();
    expect(within(blocked).getByText(/Attempts: 2/)).toBeVisible();
    expect(within(blocked).getByText(messages.lastAttempt({ time: formatDateTime('2026-11-25T07:05:00.000Z', 'en', SALES_LINK_TIME_ZONE) }))).toBeVisible();

    expect(within(within(history).getByTestId('order-staff-refund-r-failed')).getByText(messages.failedHelp)).toBeVisible();
    const done = within(history).getByTestId('order-staff-refund-r-done');
    expect(within(done).getByTestId('order-staff-refund-state')).toHaveTextContent(messages.states.succeeded);
    expect(within(done).getByText(messages.restocked)).toBeVisible();

    expect(screen.getByTestId('order-staff-refund-chip')).toHaveTextContent(messages.stateChip({ state: messages.states.blocked_permission }));
    const payment = screen.getByTestId('order-payment');
    expect(within(payment).getByText(messages.notPaidOut)).toBeVisible();
    expect(within(payment).getByText(`−${pln(9900)}`)).toBeVisible();
    expect(within(payment).getByText(messages.requestedRefund)).toBeVisible();
    expect(within(payment).getByText(`−${pln(1000)}`)).toBeVisible();
    expect(within(payment).getByText(messages.waitingForPermission)).toBeVisible();
    expect(within(blocked).getByText(messages.blockedNoAction)).toBeVisible();
    expect(within(blocked).getByRole('link', { name: messages.paymentSettingsLink })).toHaveAttribute('href', '/panel/integrations#stripe');
  });

  it('underlines the payment settings link of a refund blocked by the missing permission even where links underline only on hover', async () => {
    serve({ order: { ...paidOrder, status: 'paid' }, staffRefunds: [staffRefund({ id: 'r-blocked', status: 'blocked_permission', permissionBlockedAt: '2026-11-22T07:05:00.000Z' })] });
    await renderAt('/panel/sales/$orderId', inStudioTheme(<OrderDetailPage orderId="o1" />));
    expect(await screen.findByRole('link', { name: messages.paymentSettingsLink })).toHaveClass('MuiLink-underlineAlways');
  });

  it('puts an order taken off the packing list back with ship anyway', async () => {
    const refunded: OrderListItem = { ...paidOrder, status: 'refunded', fulfilmentStatus: null };
    const calls = serve({
      order: refunded,
      staffRefunds: [staffRefund({ kind: 'remainder', amountCents: 24900, restocked: true, removedFromPackingList: true })],
      refundTotals: { paidCents: 24900, refundedCents: 24900, remainingCents: 0, currency: 'PLN' },
    }, { ...preview, refundable: false, remainderCents: 0, refundedCents: 24900 });
    let shipAnywayCalls = 0;
    server.use(http.post('/api/orders/o1/packing-list', () => {
      shipAnywayCalls += 1;
      return HttpResponse.json({ ok: true, data: { order: { ...refunded, fulfilmentStatus: 'to_pack' } } });
    }));
    await renderDetail();

    expect(await screen.findByTestId('order-off-packing-chip')).toHaveTextContent(messages.offPackingChip);
    expect(screen.getByText(messages.offPackingRestockedNote)).toBeVisible();
    expect(within(screen.getByTestId('order-payment')).getByText(messages.fullyRefunded)).toBeVisible();
    expect(screen.queryByRole('button', { name: messages.action })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: messages.shipAnyway }));
    await waitFor(() => expect(shipAnywayCalls).toBe(1));
    await waitFor(() => expect(calls.detail).toBeGreaterThan(1));
  });

  it('shows no ship anyway action to a viewer who cannot refund', async () => {
    serve({
      order: { ...paidOrder, status: 'refunded', fulfilmentStatus: null },
      staffRefunds: [staffRefund({ removedFromPackingList: true })],
    });
    await renderDetail({ ...owner, emailVerified: false });
    expect(await screen.findByTestId('order-off-packing-list')).toBeVisible();
    expect(screen.queryByRole('button', { name: messages.shipAnyway })).toBeNull();
  });

  const serveOrders = (orders: OrderListItem[]) => {
    server.use(
      http.get('/api/orders', () => HttpResponse.json({ ok: true, data: { orders, total: orders.length, page: 1, pageSize: 25, sources: [] } })),
      http.get('/api/orders/consumer-sales-summary', ({ request }) => {
        const params = new URL(request.url).searchParams;
        return HttpResponse.json({ ok: true, data: { from: params.get('from'), to: params.get('to'), timezone: 'Europe/Warsaw', currency: 'PLN', rates: [], totals: { orderCount: 0, lineCount: 0, netCents: 0, vatCents: 0, grossCents: 0 }, orderIds: [], orders: [] } });
      }),
      http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products: [] } })),
      http.get('/api/coupons/options', () => HttpResponse.json({ ok: true, data: { coupons: [] } })),
      http.get('/api/orders/reconciliation', () => HttpResponse.json({ ok: true, data: { rows: [], checkedThrough: '2026-07-28T10:00:00.000Z' } })),
    );
  };

  it('shows the state of an unsettled staff refund in the orders list from its own field', async () => {
    serveOrders([{ ...paidOrder, staffRefundStatus: 'running', staffRefundAmountCents: 4900 }, { ...paidOrder, id: 'o2', refundJobStatus: 'failed' }, { ...paidOrder, id: 'o3' }]);
    await renderAt('/panel/sales', SalesPanel);
    expect(await screen.findByTestId('sales-staff-refund-chip')).toHaveTextContent(messages.listChip({ amount: pln(4900), state: messages.states.running }));
    expect(screen.getAllByTestId('sales-staff-refund-chip')).toHaveLength(1);
  });

  it('keeps a long buyer name on one line in the orders table with the full name in its title', async () => {
    const memberName = 'Alexandra Konstantinopolitanczykiewicz-Smith';
    serveOrders([{ ...paidOrder, memberName }]);
    await renderAt('/panel/sales', SalesPanel);
    const member = await screen.findByRole('link', { name: memberName });
    expect(member.closest('td')).toHaveAttribute('title', memberName);
  });

  describe('on a phone', () => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }));
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('opens the order from the whole card and keeps the buyer name a link to the member', async () => {
      serveOrders([paidOrder]);
      await renderAt('/panel/sales', inStudioTheme(<SalesPanel />));
      const card = await screen.findByTestId('sales-row');
      expect(within(card).getByTestId('sales-card-order-link')).toHaveAttribute('href', '/panel/sales/o1');
      expect(within(card).getByTestId('sales-card-order-link').querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      const member = within(card).getByRole('link', { name: 'Alex Smith' });
      expect(member).toHaveAttribute('href', '/panel/members/member-1');
      expect(member).toHaveClass('MuiLink-underlineAlways');
    });
  });
});
