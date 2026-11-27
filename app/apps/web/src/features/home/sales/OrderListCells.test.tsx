import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { memberTombstone, type OrderListItem } from '#core/domain/index.js';

import { en } from '../../../i18n/en.js';
import { LanguageProvider } from '../../../i18n/index.js';
import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { PanelContextProvider } from '../panel-context.js';
import { OrderMemberIdentity } from './OrderMemberIdentity.js';
import { OrderProductSummary } from './OrderProductSummary.js';
import { SalesPanel } from './SalesPanel.js';

type OrderLine = NonNullable<OrderListItem['lines']>[number];

const line = (name: string, productType: OrderLine['productType'] = 'physical'): OrderLine => ({
  productId: `product-${name}`, name, productType, quantity: 1, grossCents: 1000, netCents: 813, vatRate: 23, vatCents: 187,
  vatExemptionBasis: null, vatExemptionBasisKind: null, issuedCount: null,
});

const order = (overrides: Partial<OrderListItem> = {}): OrderListItem => ({
  id: 'o1', tenantId: 't1', memberId: 'm1', productId: 'p1', priceId: 'price-1', kind: 'one_time', status: 'paid',
  amountCents: 4900, currency: 'PLN', provider: 'simulated', providerObjectIds: {}, couponId: null, discountCents: 0,
  couponCode: null, createdAt: '2026-11-25T08:44:00.000Z', memberEmail: 'ada@example.com', memberName: 'Ada',
  productTitle: 'Workshop', mode: 'live',
  ...overrides,
});

const twelveItems = [...Array.from({ length: 11 }, (_, index) => line(`Item ${String(index + 1)}`)), line('Parcel locker delivery', 'shipping')];

const renderRouted = async (element: ReactElement, language: 'en' | 'pl' = 'en') => {
  window.localStorage.setItem('together-language', language);
  const rootRoute = createRootRoute();
  const route = createRoute({ getParentRoute: () => rootRoute, path: '/panel/sales', component: () => element });
  const router = createRouter({ routeTree: rootRoute.addChildren([route]), history: createMemoryHistory({ initialEntries: ['/panel/sales'] }) });
  await router.load();
  return renderWithProviders(
    <LanguageProvider>
      <PanelContextProvider value={{ tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: 'admin', memberId: 'm9' }, email: 'admin@example.com', emailVerified: true }}>
        <RouterProvider router={router} />
      </PanelContextProvider>
    </LanguageProvider>,
  );
};

afterEach(() => { window.localStorage.removeItem('together-language'); });

describe('OrderProductSummary', () => {
  it('shows the first item and the count of the rest, and expands the full list from the keyboard', async () => {
    const user = userEvent.setup();
    await renderRouted(<OrderProductSummary order={order({ lines: twelveItems })} />);
    expect(await screen.findByTestId('sales-product-first')).toHaveTextContent('Item 1');
    expect(screen.getByTestId('sales-product-more')).toHaveTextContent(`+11${en.sales.moreItemsLabel({ count: 11 })}`);
    const items = screen.getByTestId('sales-product-items');
    expect(items).not.toBeVisible();
    const toggle = screen.getByRole('button', { name: en.sales.orderLines({ count: 12 }) });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', items.id);

    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName(en.sales.orderLines({ count: 12 }));
    expect(items).toBeVisible();
    expect(within(items).getAllByRole('listitem').map((item) => item.textContent)).toEqual(twelveItems.map((entry) => entry.name));

    await user.keyboard(' ');
    expect(items).not.toBeVisible();
  });

  it('shows a single item without a disclosure control', async () => {
    await renderRouted(<OrderProductSummary order={order({ lines: [line('Workshop recording', 'course')] })} />);
    expect(await screen.findByTestId('sales-product-first')).toHaveTextContent('Workshop recording');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('sales-product-more')).toBeNull();
  });

  it('keeps the sales link and the personalisation marker visible while collapsed, in Polish', async () => {
    const personalization = {
      text: 'For Sam', label: 'Dedication', description: 'Printed', inputLabel: 'Text', condition: null, maxLength: 60,
      requestedAt: '2026-11-24T20:11:00.000Z', conditionAcceptedAt: null,
    };
    await renderRouted(<OrderProductSummary order={order({ salesLinkId: 'sl1', salesLinkTitle: 'Starter bundle', lines: [{ ...line('Printed copy'), personalization }, line('Notebook')] })} />, 'pl');
    expect(await screen.findByText(`${pl.salesLinks.salesLink}: Starter bundle`)).toBeVisible();
    expect(screen.getByTestId('sales-personalization-chip')).toHaveTextContent(pl.personalization.marker);
    expect(screen.getByRole('button', { name: pl.sales.orderLines({ count: 2 }) })).toBeVisible();
    expect(screen.getByTestId('sales-product-more')).toHaveTextContent(`+1${pl.sales.moreItemsLabel({ count: 1 })}`);
  });

  it('falls back to the product title for an order without lines', async () => {
    await renderRouted(<OrderProductSummary order={order()} />);
    expect(await screen.findByTestId('sales-product-first')).toHaveTextContent('Workshop');
  });
});

describe('OrderMemberIdentity', () => {
  it('shows the name and the e-mail, both leading to the member account, with one tab stop', async () => {
    await renderRouted(<OrderMemberIdentity order={order()} />);
    const link = await screen.findByRole('link', { name: en.sales.openMemberAccount({ member: 'Ada (ada@example.com)' }) });
    expect(link).toHaveAttribute('href', '/panel/members/m1');
    expect(link).toHaveTextContent('Ada');
    const email = screen.getByTestId('order-member-email');
    expect(email).toHaveTextContent('ada@example.com');
    const emailLink = within(email).getByRole('link', { name: 'ada@example.com' });
    expect(emailLink).toHaveAttribute('href', '/panel/members/m1');
    expect(emailLink).toHaveAttribute('tabindex', '-1');
    await userEvent.setup().tab();
    expect(link).toHaveFocus();
    await userEvent.setup().tab();
    expect(document.body).toHaveFocus();
  });

  it('shows the e-mail alone as the link when there is no display name, in Polish', async () => {
    await renderRouted(<OrderMemberIdentity order={order({ memberName: null })} />, 'pl');
    const link = await screen.findByRole('link', { name: pl.sales.openMemberAccount({ member: 'ada@example.com' }) });
    expect(link).toHaveTextContent('ada@example.com');
    expect(link).toHaveAttribute('href', '/panel/members/m1');
  });

  it('shows an erased member as text without a link and never the replacement address', async () => {
    const tombstone = memberTombstone('m1');
    await renderRouted(<OrderMemberIdentity order={order({ memberName: null, memberEmail: tombstone.email })} />);
    expect(await screen.findByTestId('order-member-erased')).toHaveTextContent(en.deletedContent.member);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(tombstone.email)).toBeNull();
  });
});

describe('SalesPanel row', () => {
  it('shows the date on two lines as the link to the order, the coupon code or a dash, and never an erased address', async () => {
    server.use(
      http.get('/api/orders/consumer-sales-summary', () => HttpResponse.json({ ok: true, data: { from: '2026-11-01', to: '2026-11-30', timezone: 'Europe/Warsaw', currency: 'PLN', rates: [], totals: { orderCount: 0, lineCount: 0, netCents: 0, vatCents: 0, grossCents: 0 }, orderIds: [], orders: [] } })),
      http.get('/api/orders/reconciliation', () => HttpResponse.json({ ok: true, data: { rows: [], checkedThrough: '2026-11-25T12:00:00.000Z' } })),
      http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products: [] } })),
      http.get('/api/coupons/options', () => HttpResponse.json({ ok: true, data: { coupons: [] } })),
      http.get('/api/orders', () => HttpResponse.json({ ok: true, data: {
        orders: [order({ couponCode: 'AUTUMN20', couponId: 'c1' }), order({ id: 'o2' }), order({ id: 'o3', memberId: 'm3', memberName: null, memberEmail: memberTombstone('m3').email })], sources: [], total: 3, page: 1, pageSize: 25,
      } })),
    );
    await renderRouted(<SalesPanel />);
    const [withCoupon, withoutCoupon, erased] = await screen.findAllByTestId('sales-row');
    if (withCoupon === undefined || withoutCoupon === undefined || erased === undefined) throw new Error('Expected three order rows');
    const dateLink = within(withCoupon).getByRole('link', { name: '25 Nov 2026, 09:44' });
    expect(dateLink).toHaveAttribute('href', '/panel/sales/o1');
    expect([...dateLink.children].map((child) => child.textContent)).toEqual(['25 Nov 2026', '09:44']);
    expect(within(withCoupon).getByTestId('sales-row-coupon')).toHaveTextContent('AUTUMN20');
    expect(within(withoutCoupon).getByTestId('sales-row-coupon')).toHaveTextContent('—');
    expect(within(withCoupon).getByTestId('order-member-email').closest('[title]')).toHaveAttribute('title', 'Ada\nada@example.com');
    const erasedCell = within(erased).getByTestId('order-member-erased').closest('[title]');
    expect(erasedCell).toHaveAttribute('title', en.deletedContent.member);
    expect(erased).not.toHaveTextContent(memberTombstone('m3').email);
  });
});
