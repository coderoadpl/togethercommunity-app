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

const stubOffer = (
  overrides: {
    legal?: { termsUrl: string | null; privacyUrl: string | null };
    support?: { url: string | null };
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
          products: [],
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
    expect(screen.queryByTestId('auth-footer-community')).not.toBeInTheDocument();
    expect(screen.queryByTestId('auth-footer-privacy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('auth-footer-support')).not.toBeInTheDocument();
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

  it('puts the legal links ahead of support in the footer', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    stubOffer({
      legal: { termsUrl: 'https://example.test/terms', privacyUrl: 'https://example.test/privacy' },
      support: { url: 'https://example.test/help' },
    });
    stubNavigation({ defaultHomeSpaceId: 'space-1', courseIds: ['course-1'] });

    await renderShell(TENANT_HOST);

    await screen.findByTestId('auth-footer-support');
    const links = screen.getByTestId('auth-footer-links');
    expect([...links.querySelectorAll('a')].map((link) => link.dataset['testid'])).toEqual([
      'auth-footer-courses',
      'auth-footer-community',
      'auth-footer-terms',
      'auth-footer-privacy',
      'auth-footer-support',
    ]);
  });

  it('links the home space when the tenant publishes one', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    stubOffer({ support: { url: 'https://example.test/help' } });
    stubNavigation({ defaultHomeSpaceId: 'space-1', courseIds: [] });

    await renderShell(TENANT_HOST);

    expect(await screen.findByTestId('auth-footer-community')).toHaveAttribute(
      'href',
      '/community/space-1',
    );
    expect(screen.getByTestId('auth-footer-support')).toHaveAttribute(
      'href',
      'https://example.test/help',
    );
    expect(screen.getByTestId('auth-footer-support')).toHaveTextContent(pl.auth.cannotSignIn);
    expect(screen.queryByTestId('auth-footer-courses')).not.toBeInTheDocument();
  });

  it('reduces the platform surface footer to the Together wordmark alone', async () => {
    vi.stubEnv('VITE_APP_BASE_DOMAIN', 'togethercommunity.app');
    let offerCalls = 0;
    server.use(
      http.get('*/api/public/offer', () => {
        offerCalls += 1;
        return HttpResponse.json({ ok: true, data: {} });
      }),
    );

    await renderShell('togethercommunity.app');

    expect(screen.getByTestId('auth-together-logo')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-footer-links')).not.toBeInTheDocument();
    await waitFor(() => expect(offerCalls).toBe(0));
  });
});
