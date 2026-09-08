import { ThemeProvider, type Theme } from '@mui/material/styles';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppChromeProvider } from '../../components/ui/app-chrome.js';
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher.js';
import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { applyBranding } from '../../theme-branding.js';
import { ThemeModeProvider } from '../../theme-mode.js';
import { AuthShell } from './AuthShell.js';

const TENANT_HOST = 'akademia.togethercommunity.app';

const DOWNLOAD_PRODUCT = {
  id: 'product-1',
  type: 'digital_download',
  slug: 'workbook',
  title: 'Workbook',
  description: '',
  coverUrl: null,
  priceCents: 1000,
  currency: 'PLN',
  prices: [],
  marketingConsents: [],
};

const stubOffer = (
  overrides: {
    legal?: { termsUrl: string | null; privacyUrl: string | null };
    support?: { url: string | null };
    withDownload?: boolean;
  } = {},
) =>
  server.use(
    http.get('*/api/public/offer', () =>
      HttpResponse.json({
        ok: true,
        data: {
          tenant: {
            slug: 'akademia',
            name: 'Akademia Demo',
            branding: { logoUrl: null, accentColor: null, faviconUrl: null },
            socialLinks: [],
            legal: overrides.legal ?? { termsUrl: null, privacyUrl: null },
            support: overrides.support ?? { url: null },
          },
          contentVersion: 1,
          previewLessons: [],
          products: overrides.withDownload === true ? [DOWNLOAD_PRODUCT] : [],
        },
      }),
    ),
  );

const stubNavigation = (
  navigation: { defaultHomeSpaceId: string | null; courseIds: string[] },
) =>
  server.use(
    http.get('*/api/public/navigation', () =>
      HttpResponse.json({
        ok: true,
        data: {
          navigation: {
            defaultHomeSpaceId: navigation.defaultHomeSpaceId,
            spaces: [],
            courses: navigation.courseIds.map((id) => ({
              id,
              name: id,
              description: '',
              imageUrl: null,
            })),
            lockedSpaces: [],
          },
        },
      }),
    ),
  );

const renderShell = async (hostname: string, accentColor: string | null = null) => {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <LanguageSwitcher />
        <ThemeProvider
          theme={(outer: Theme) =>
            applyBranding(outer, {
              logoUrl: null,
              logoDarkUrl: null,
              accentColor,
              faviconUrl: null,
            })
          }
        >
          <AuthShell hostname={hostname}>
            <h1>Zaloguj się</h1>
          </AuthShell>
        </ThemeProvider>
      </>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/login'] }),
  });
  await router.load();
  return renderWithProviders(
    <ThemeModeProvider>
      <AppChromeProvider>
        <RouterProvider router={router} />
      </AppChromeProvider>
    </ThemeModeProvider>,
  );
};

afterEach(() => vi.unstubAllEnvs());

describe('AuthShell', () => {
  it('carries exactly one language switch, next to the colour-scheme control', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    stubOffer();

    await renderShell(TENANT_HOST);

    expect(screen.getAllByTestId('language-switcher')).toHaveLength(1);
    const controls = screen.getByRole('group', { name: pl.auth.preferences });
    expect(controls).toContainElement(screen.getByTestId('language-switcher'));
    expect(controls).toContainElement(screen.getByTestId('color-scheme-cycle'));
  });

  it('exposes the header and footer as their own landmarks beside the content', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    stubOffer();

    await renderShell(TENANT_HOST);

    const main = screen.getByRole('main');
    expect(main).toContainElement(screen.getByRole('heading', { level: 1 }));
    expect(main).not.toContainElement(screen.getByRole('banner'));
    expect(main).not.toContainElement(screen.getByRole('contentinfo'));
    expect(screen.getByRole('banner')).toContainElement(screen.getByTestId('auth-brand'));
    expect(screen.getByRole('contentinfo')).toContainElement(screen.getByTestId('auth-powered-by'));
  });

  it('signs the tenant footer with the full Together wordmark for the active scheme', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    stubOffer();
    window.localStorage.setItem('together-color-scheme', 'light');

    await renderShell(TENANT_HOST);

    const logo = screen.getByTestId('auth-together-logo');
    expect(screen.getByTestId('auth-powered-by')).toHaveTextContent(pl.auth.poweredBy);
    expect(logo).toHaveAttribute('alt', 'Together');
    expect(logo).toHaveAttribute('src', '/brand/together-horizontal-light.svg');

    await userEvent.click(screen.getByTestId('color-scheme-cycle'));

    await waitFor(() =>
      expect(screen.getByTestId('auth-together-logo')).toHaveAttribute(
        'src',
        '/brand/together-horizontal-dark.svg',
      ),
    );
  });

  it('lists only the public destinations the tenant actually has', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    stubOffer({ legal: { termsUrl: 'https://example.test/terms', privacyUrl: null } });
    stubNavigation({ defaultHomeSpaceId: null, courseIds: ['course-1'] });

    await renderShell(TENANT_HOST);

    expect(await screen.findByTestId('auth-footer-courses')).toHaveAttribute('href', '/');
    expect(await screen.findByTestId('auth-footer-terms')).toHaveAttribute(
      'href',
      'https://example.test/terms',
    );
    expect(screen.queryByTestId('auth-footer-privacy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('auth-footer-support')).not.toBeInTheDocument();
  });

  it('puts the public navigation row before the final Together line', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    stubOffer();
    stubNavigation({ defaultHomeSpaceId: 'space-1', courseIds: ['course-1'] });

    await renderShell(TENANT_HOST);

    const strip = await screen.findByRole('navigation', { name: pl.auth.publicNavLabel });
    expect([...strip.querySelectorAll('a')].map((link) => link.textContent)).toEqual([
      pl.auth.publicNavCourses,
      pl.auth.publicNavCommunity,
    ]);
    expect(screen.getByTestId('auth-public-nav-courses')).toHaveAttribute('href', '/');
    expect(screen.getByTestId('auth-public-nav-community')).toHaveAttribute(
      'href',
      '/community/space-1',
    );
    for (const link of strip.querySelectorAll('a')) {
      expect(link.querySelector('svg')).toBeInTheDocument();
      expect(window.getComputedStyle(link).getPropertyValue('min-height')).toBe('44px');
      expect(link).toHaveClass('MuiLink-root');
    }
    const footer = screen.getByRole('contentinfo');
    expect(strip.parentElement).toBe(footer);
    expect(footer.children.item(footer.children.length - 2)).toBe(strip);
    expect(footer.lastElementChild).toBe(screen.getByTestId('auth-powered-by'));
  });

  it('drops the navigation row entries the tenant does not publish', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    stubOffer();
    stubNavigation({ defaultHomeSpaceId: null, courseIds: ['course-1'] });

    await renderShell(TENANT_HOST);

    expect(await screen.findByTestId('auth-public-nav-courses')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-public-nav-community')).not.toBeInTheDocument();
  });

  it('omits the navigation row when a download is all the tenant publishes', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    stubOffer({ withDownload: true });
    stubNavigation({ defaultHomeSpaceId: null, courseIds: [] });

    await renderShell(TENANT_HOST);

    await screen.findByTestId('auth-powered-by');
    expect(screen.queryByTestId('auth-public-nav')).not.toBeInTheDocument();
  });

  it('underlines the footer links so they read as links beside the prose', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    stubOffer({ legal: { termsUrl: 'https://example.test/terms', privacyUrl: null } });
    stubNavigation({ defaultHomeSpaceId: null, courseIds: ['course-1'] });

    await renderShell(TENANT_HOST);

    const link = await screen.findByTestId('auth-footer-terms');
    expect(window.getComputedStyle(link).getPropertyValue('text-decoration-line')).toBe('underline');
  });

  it('lights the corner glow only for a tenant that supplied an accent', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    stubOffer();

    const unbranded = await renderShell(TENANT_HOST);
    expect(screen.queryByTestId('auth-glow')).not.toBeInTheDocument();
    unbranded.unmount();

    await renderShell(TENANT_HOST, '#E2632B');
    expect(screen.getByTestId('auth-glow')).toBeInTheDocument();
  });

  it('orders the footer: catalogue prompt, support prompt, legal links, public nav, Together mark', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    stubOffer({
      legal: { termsUrl: 'https://example.test/terms', privacyUrl: 'https://example.test/privacy' },
      support: { url: 'https://example.test/help' },
    });
    stubNavigation({ defaultHomeSpaceId: 'space-1', courseIds: ['course-1'] });

    await renderShell(TENANT_HOST);

    await screen.findByTestId('auth-footer-access');
    const footer = screen.getByRole('contentinfo');
    expect([...footer.children].map((child) => child.getAttribute('data-testid'))).toEqual([
      'auth-footer-access',
      'auth-footer-help',
      'auth-footer-links',
      'auth-public-nav',
      'auth-powered-by',
    ]);
    expect(screen.getByTestId('auth-footer-access')).toHaveTextContent(
      `${pl.auth.noAccessPrompt} ${pl.auth.noAccessLink({ tenant: 'Akademia Demo' })}`,
    );
    expect(screen.getByTestId('auth-footer-help')).toHaveTextContent(
      `${pl.auth.cannotSignInPrompt} ${pl.auth.cannotSignInLink}`,
    );
    expect([...screen.getByTestId('auth-footer-links').querySelectorAll('a')].map(
      (link) => link.dataset['testid'],
    )).toEqual(['auth-footer-terms', 'auth-footer-privacy']);
  });

  it('keeps the support prompt without a catalogue the tenant does not publish', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    stubOffer({ support: { url: 'https://example.test/help' } });
    stubNavigation({ defaultHomeSpaceId: 'space-1', courseIds: [] });

    await renderShell(TENANT_HOST);

    expect(await screen.findByTestId('auth-footer-support')).toHaveAttribute(
      'href',
      'https://example.test/help',
    );
    expect(screen.queryByTestId('auth-footer-access')).not.toBeInTheDocument();
    expect(screen.queryByTestId('auth-footer-links')).not.toBeInTheDocument();
  });

  it('reduces the platform surface footer to the Together wordmark alone', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    let offerCalls = 0;
    let navigationCalls = 0;
    server.use(
      http.get('*/api/public/offer', () => {
        offerCalls += 1;
        return HttpResponse.json({ ok: true, data: {} });
      }),
      http.get('*/api/public/navigation', () => {
        navigationCalls += 1;
        return HttpResponse.json({ ok: true, data: {} });
      }),
    );

    await renderShell('togethercommunity.app');

    expect(screen.getByTestId('auth-together-logo')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-footer-links')).not.toBeInTheDocument();
    await waitFor(() => expect(offerCalls).toBe(0));
    expect(navigationCalls).toBe(0);
    expect(screen.queryByTestId('auth-public-nav')).not.toBeInTheDocument();
  });
});
