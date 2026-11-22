import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { PublicNavigation, SpaceFeedItem } from '#core/domain/index.js';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { AnonHomePage } from './AnonHomePage.js';

const navigation = (overrides: Partial<PublicNavigation> = {}): PublicNavigation => ({
  defaultHomeSpaceId: 's1',
  spaces: [
    { id: 's1', slug: 'general', name: 'General', description: 'Discussions.', position: 0 },
    { id: 's2', slug: 'club', name: 'Club', description: 'Club discussions.', position: 1 },
  ],
  courses: [{ id: 'c1', name: 'JavaScript from scratch', description: 'Starter course.', imageUrl: null }],
  lockedSpaces: [
    { id: 's9', slug: 'premium', name: 'Premium', description: null, productIds: ['p1'] },
  ],
  ...overrides,
});

const okNavigation = (value: PublicNavigation = navigation()) =>
  http.get('/api/public/navigation', () =>
    HttpResponse.json({ ok: true, data: { navigation: value } }));

const feedItem = (id: string, body: string): SpaceFeedItem => ({
  id,
  tenantId: 't1',
  contextKind: 'space',
  contextId: 's1',
  parentPostId: null,
  rootPostId: id,
  isOwn: false,
  authorDisplay: 'Ola Autorka',
  authorIsStaff: false,
  authorAvatarUrl: null,
  body,
  bodyFormat: 'plain',
  bodyHtml: body,
  bodyPlainText: body,
  createdAt: '2026-07-20T08:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  replyCount: 0,
  reactions: [],
});

const okFeed = (items: SpaceFeedItem[]) =>
  http.get('/api/public/spaces/:spaceId/feed', () =>
    HttpResponse.json({
      ok: true,
      data: { feed: { spaceId: 's1', items, pinned: [], nextCursor: null, isFollowing: false } },
    }),
  );

type OfferProductInput = {
  id: string;
  title: string;
  prices?: { id: string; kind: 'one_time' | 'recurring'; interval: 'month' | 'year' | null; amountCents: number; currency: string }[];
};

const offerProduct = ({ id, title, prices }: OfferProductInput) => ({
  id,
  type: 'course',
  slug: id,
  title,
  description: '',
  coverUrl: null,
  priceCents: prices?.[0]?.amountCents ?? 19_900,
  currency: 'PLN',
  prices: prices ?? [{ id: `price-${id}`, kind: 'one_time', interval: null, amountCents: 19_900, currency: 'PLN' }],
});

type OfferSalesLinkInput = { id: string; slug: string; heading: string; description: string; totalCents: number; currency: string };

const okOffer = ({
  products = [],
  salesLinks = [],
  previewLessons = [],
}: {
  products?: ReturnType<typeof offerProduct>[];
  salesLinks?: OfferSalesLinkInput[];
  previewLessons?: { id: string; name: string; courseId: string }[];
} = {}) =>
  http.get('/api/public/offer', () =>
    HttpResponse.json({
      ok: true,
      data: { tenant: { slug: 'acme', name: 'Acme Academy' }, contentVersion: 1, products, salesLinks, previewLessons },
    }));

const renderPage = async (initialEntry = '/') => {
  const rootRoute = createRootRoute({ component: AnonHomePage });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('AnonHomePage', () => {
  it('opens with the home space feed above the public tiles', async () => {
    server.use(okNavigation(), okFeed([feedItem('p1', 'Wpis powitalny')]), okOffer());

    await renderPage();

    expect(await screen.findByTestId('public-feed-post-p1')).toHaveTextContent('Wpis powitalny');
    expect(screen.getByTestId('anon-home-feed')).toHaveTextContent('General');
    expect(within(screen.getByTestId('anon-home-feed')).getByRole('heading', { level: 2, name: 'General' })).toContainElement(
      screen.getByTestId('anon-home-feed-link'),
    );
    expect(screen.getByTestId('anon-home-feed-link')).toHaveAttribute('href', '/community/s1');
    expect(screen.getByTestId('anon-read-only-banner')).toHaveTextContent(en.anon.readOnlyBanner);
    expect(screen.getByTestId('space-card-s2')).toHaveAttribute('href', '/community/s2');
    expect(screen.queryByTestId('space-card-s1')).not.toBeInTheDocument();
    expect(screen.getByTestId('course-card-c1')).toHaveAttribute('href', '/my/courses/c1');
    expect(screen.getByTestId('locked-space-cta-s9')).toHaveAttribute('href', '/checkout/p1');
  });

  it('labels the public tile sections for a visitor and offers a sign-in link in the banner', async () => {
    server.use(okNavigation(), okFeed([]), okOffer());

    await renderPage();

    expect(await screen.findByTestId('anon-courses')).toHaveTextContent(en.anon.coursesSection);
    expect(screen.getByTestId('anon-spaces')).toHaveTextContent(en.anon.spacesSection);
    expect(screen.getByTestId('anon-courses')).not.toHaveTextContent(en.start.coursesSection);
    expect(
      within(screen.getByTestId('anon-read-only-banner')).getByRole('link', {
        name: en.auth.signInLink,
      }),
    ).toHaveAttribute('href', '/login');
  });

  it('drops the feed section and tiles every space when no home space is configured', async () => {
    server.use(okNavigation(navigation({ defaultHomeSpaceId: null })), okOffer());

    await renderPage();

    expect(await screen.findByTestId('space-card-s1')).toBeInTheDocument();
    expect(screen.getByTestId('space-card-s2')).toBeInTheDocument();
    expect(screen.queryByTestId('anon-home-feed')).not.toBeInTheDocument();
  });

  it('drops the tile section when the home space is the only public space', async () => {
    server.use(
      okNavigation(
        navigation({
          spaces: [{ id: 's1', slug: 'general', name: 'General', description: 'Discussions.', position: 0 }],
        }),
      ),
      okFeed([]),
      okOffer(),
    );

    await renderPage();

    expect(await screen.findByTestId('anon-home-feed')).toHaveTextContent('General');
    expect(screen.queryByTestId('anon-spaces')).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing is public', async () => {
    server.use(
      okNavigation({ defaultHomeSpaceId: null, spaces: [], courses: [], lockedSpaces: [] }),
      okOffer(),
    );

    await renderPage();

    const empty = await screen.findByTestId('anon-empty-state');
    expect(empty).toHaveTextContent(en.anon.emptyTitle);
    expect(empty).toHaveTextContent(en.anon.emptyBody);
  });

  it('uses the workspace name as the page heading under the visitor eyebrow', async () => {
    server.use(okNavigation(), okFeed([]), okOffer());

    await renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Acme Academy' })).toBeInTheDocument();
    expect(screen.getByText(en.anon.eyebrow)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: en.anon.homeTitle })).not.toBeInTheDocument();
  });

  it('lists catalogue products with their price and a checkout button in the offer section', async () => {
    server.use(
      okNavigation(),
      okFeed([]),
      okOffer({
        products: [
          offerProduct({ id: 'prod-course', title: 'Starter course' }),
          offerProduct({
            id: 'prod-club',
            title: 'Club membership',
            prices: [
              { id: 'price-month', kind: 'recurring', interval: 'month', amountCents: 4_900, currency: 'PLN' },
              { id: 'price-year', kind: 'recurring', interval: 'year', amountCents: 49_900, currency: 'PLN' },
            ],
          }),
          offerProduct({
            id: 'prod-free',
            title: 'Free sampler',
            prices: [{ id: 'price-free', kind: 'one_time', interval: null, amountCents: 0, currency: 'PLN' }],
          }),
        ],
      }),
    );

    await renderPage();

    const section = await screen.findByTestId('anon-offer');
    expect(section).toHaveAttribute('id', 'offer');
    expect(within(section).getByRole('heading', { level: 2, name: en.anon.offersSection })).toBeInTheDocument();
    expect(within(section).getByRole('heading', { level: 3, name: 'Starter course' })).toBeInTheDocument();
    expect(screen.getByTestId('offer-product-prod-course-price').textContent).toMatch(/199/);
    expect(screen.getByTestId('offer-product-prod-course-price')).toHaveTextContent('one-off');
    expect(screen.getByTestId('offer-product-cta-prod-course')).toHaveAttribute('href', '/checkout/prod-course');
    expect(screen.getByTestId('offer-product-cta-prod-course')).toHaveTextContent(en.anon.offerBuyCta);
    expect(screen.getByTestId('offer-product-prod-club-price')).toHaveTextContent('/mo.');
    expect(screen.getByTestId('offer-product-prod-club-price')).toHaveTextContent('/yr.');
    expect(screen.getByTestId('offer-product-prod-free-price')).toHaveTextContent(en.common.free);
    expect(screen.getByTestId('offer-product-cta-prod-free')).toHaveTextContent(en.checkout.freeOrderIdle);
    expect(screen.getByTestId('anon-spaces')).not.toHaveAttribute('id');
  });

  it('lists each product once even when the payload repeats it', async () => {
    server.use(
      okNavigation(),
      okFeed([]),
      okOffer({
        products: [
          offerProduct({ id: 'p1', title: 'Premium access' }),
          offerProduct({ id: 'p1', title: 'Premium access' }),
        ],
      }),
    );

    await renderPage();

    const section = await screen.findByTestId('anon-offer');
    expect(within(section).getAllByTestId('offer-product-p1')).toHaveLength(1);
  });

  it('lists public bundles in the offer section with their description and a button-styled call to action', async () => {
    server.use(
      okNavigation(navigation({ defaultHomeSpaceId: null, spaces: [], courses: [], lockedSpaces: [] })),
      okOffer({
        salesLinks: [{ id: 'link-1', slug: 'complete-bundle', heading: 'Complete bundle', description: 'Every course in one pack.', totalCents: 4200, currency: 'PLN' }],
      }),
    );

    await renderPage();

    const section = await screen.findByTestId('anon-offer');
    expect(section).toHaveAttribute('id', 'offer');
    expect(within(section).getByRole('link', { name: en.salesLinks.buyBundle })).toHaveAttribute('href', '/offer/complete-bundle');
    expect(within(section).getByRole('heading', { level: 3, name: 'Complete bundle' })).toBeInTheDocument();
    expect(section).toHaveTextContent('Every course in one pack.');
    expect(section).not.toHaveTextContent(en.salesLinks.heading);
    expect(screen.queryByTestId('anon-empty-state')).toBeNull();
  });

  it('counts catalogue products when deciding whether the home is empty', async () => {
    server.use(
      okNavigation(navigation({ defaultHomeSpaceId: null, spaces: [], courses: [], lockedSpaces: [] })),
      okOffer({ products: [offerProduct({ id: 'prod-annual', title: 'Annual access' })] }),
    );

    await renderPage();

    expect(await screen.findByTestId('offer-product-prod-annual')).toBeInTheDocument();
    expect(screen.queryByTestId('anon-empty-state')).toBeNull();
  });

  it('puts the offer anchor on locked spaces, then courses, then spaces when there is no offer section', async () => {
    server.use(okNavigation(), okFeed([]), okOffer());
    const first = await renderPage();
    expect(await screen.findByTestId('anon-locked')).toHaveAttribute('id', 'offer');
    expect(screen.getByTestId('anon-courses')).not.toHaveAttribute('id');
    first.unmount();

    server.use(okNavigation(navigation({ lockedSpaces: [] })));
    const second = await renderPage();
    expect(await screen.findByTestId('anon-courses')).toHaveAttribute('id', 'offer');
    expect(screen.getByTestId('anon-spaces')).not.toHaveAttribute('id');
    second.unmount();

    server.use(okNavigation(navigation({ lockedSpaces: [], courses: [] })));
    await renderPage();
    expect(await screen.findByTestId('anon-spaces')).toHaveAttribute('id', 'offer');
    expect(screen.queryByTestId('anon-offer-jump')).not.toBeInTheDocument();
  });

  it('offers a jump to the offer in the read-only banner when something is for sale', async () => {
    server.use(okNavigation(), okFeed([]), okOffer({ products: [offerProduct({ id: 'p1', title: 'Premium access' })] }));

    await renderPage();

    const banner = await screen.findByTestId('anon-read-only-banner');
    expect(within(banner).getByRole('link', { name: en.anon.salesCta })).toHaveAttribute('href', '/#offer');
    expect(within(banner).getByRole('link', { name: en.auth.signInLink })).toHaveAttribute('href', '/login');
  });

  it('names the product price on a locked-space button and keeps the plain label without one', async () => {
    server.use(
      okNavigation(navigation({
        lockedSpaces: [
          { id: 's9', slug: 'premium', name: 'Premium', description: null, productIds: ['p1'] },
          { id: 's8', slug: 'vip', name: 'VIP', description: null, productIds: ['p-unlisted'] },
        ],
      })),
      okFeed([]),
      okOffer({ products: [offerProduct({ id: 'p1', title: 'Premium access' })] }),
    );

    await renderPage();

    const priced = await screen.findByTestId('locked-space-cta-s9');
    await waitFor(() => expect(priced.textContent).toMatch(/^Unlock access — .*199/));
    expect(priced).toHaveAttribute('href', '/checkout/p1');
    expect(screen.getByTestId('locked-space-cta-s8')).toHaveTextContent(en.courseTree.unlockAccess);
    expect(screen.getByTestId('locked-space-cta-s8').textContent).not.toContain('—');
  });

  it('marks a course card with the preview chip when one of its lessons is a free preview', async () => {
    server.use(
      okNavigation(navigation({
        courses: [
          { id: 'c1', name: 'JavaScript from scratch', description: 'Starter course.', imageUrl: null },
          { id: 'c2', name: 'TypeScript', description: '', imageUrl: null },
        ],
      })),
      okFeed([]),
      okOffer({ previewLessons: [{ id: 'l1', name: 'Variables', courseId: 'c1' }] }),
    );

    await renderPage();

    expect(await screen.findByTestId('course-preview-c1')).toHaveTextContent(en.anon.previewChip);
    expect(screen.queryByTestId('course-preview-c2')).not.toBeInTheDocument();
  });

  it('scrolls to the offer section when the page opens on the offer anchor', async () => {
    const scrolled: string[] = [];
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function record(this: Element) {
      scrolled.push(this.id);
    });
    try {
      server.use(okNavigation(), okFeed([]), okOffer({ products: [offerProduct({ id: 'p1', title: 'Premium access' })] }));

      await renderPage('/#offer');

      await screen.findByTestId('anon-offer');
      await waitFor(() => expect(scrolled).toContain('offer'));
    } finally {
      spy.mockRestore();
    }
  });
});
