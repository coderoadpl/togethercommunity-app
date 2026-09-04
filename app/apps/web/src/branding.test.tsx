import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrandMark, TenantLogo, TenantSocialLinks } from './branding.js';
import { MemberPage } from './components/layout/index.js';
import { renderWithProviders } from './test/render.js';
import { server } from './test/server.js';
import { colorSchemePreference, ThemeModeProvider, useColorScheme } from './theme-mode.js';

const offerHandler = (
  branding: {
    logoUrl: string | null;
    logoDarkUrl?: string | null;
    accentColor: string | null;
    faviconUrl: string | null;
  },
  socialLinks: Array<{ label: string; url: string }> = [],
) =>
  http.get('/api/public/offer', () =>
    HttpResponse.json({
      ok: true,
      data: {
        tenant: { slug: 'akademia', name: 'Akademia Samouka', branding, socialLinks },
        contentVersion: 1,
        products: [],
      },
    }),
  );

const BRANDED = {
  logoUrl: '/assets/akademia-logo.svg',
  logoDarkUrl: null,
  accentColor: '#0E7490',
  faviconUrl: '/assets/akademia-logo.svg',
};

const TWO_VARIANTS = {
  logoUrl: '/assets/akademia-light.svg',
  logoDarkUrl: '/assets/akademia-dark.svg',
  accentColor: null,
  faviconUrl: null,
};

const matchMediaController = () => {
  let dark = false;
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const media = {
    get matches() {
      return dark;
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener);
    },
    dispatchEvent: () => true,
  };
  vi.stubGlobal('matchMedia', () => media);
  return {
    setDark: (value: boolean) => {
      dark = value;
      const event = new Event('change');
      Object.defineProperty(event, 'matches', { value });
      for (const listener of listeners) {
        if (typeof listener === 'function') listener(event);
        else listener.handleEvent(event);
      }
    },
  };
};

const SchemeToggle = () => {
  const { setColorScheme } = useColorScheme();
  return (
    <button type="button" onClick={() => setColorScheme('dark')}>
      ciemny
    </button>
  );
};

const renderThemed = (children: React.ReactNode) =>
  renderWithProviders(
    <ThemeModeProvider>
      {children}
      <SchemeToggle />
    </ThemeModeProvider>,
  );

describe('TenantLogo', () => {
  it('renders the tenant logo with the tenant name as its alt text', async () => {
    server.use(offerHandler(BRANDED));
    renderWithProviders(<TenantLogo />);

    const logo = await screen.findByTestId('tenant-logo');
    expect(logo).toHaveAttribute('src', '/assets/akademia-logo.svg');
    expect(logo).toHaveAttribute('alt', 'Akademia Samouka');
  });

  it('renders the tenant name without a logo', async () => {
    server.use(offerHandler({ logoUrl: null, logoDarkUrl: null, accentColor: null, faviconUrl: null }));
    renderWithProviders(<TenantLogo />);

    expect(await screen.findByTestId('tenant-name-mark')).toHaveTextContent('Akademia Samouka');
    expect(screen.queryByTestId('tenant-logo')).not.toBeInTheDocument();
  });

  it('renders the resolved tenant logo on a bare host', async () => {
    server.use(offerHandler(BRANDED));
    renderWithProviders(<TenantLogo />);

    expect(await screen.findByTestId('tenant-logo')).toHaveAttribute(
      'src',
      '/assets/akademia-logo.svg',
    );
  });
});

describe('BrandMark', () => {
  it('shows the tenant logo when branded', async () => {
    server.use(offerHandler(BRANDED));
    renderWithProviders(<BrandMark />);

    const logo = await screen.findByTestId('tenant-brand-logo');
    expect(logo).toHaveAttribute('src', '/assets/akademia-logo.svg');
    expect(screen.queryByAltText('Together')).not.toBeInTheDocument();
  });

  it('falls back to the tenant name when unbranded', async () => {
    server.use(offerHandler({ logoUrl: null, logoDarkUrl: null, accentColor: null, faviconUrl: null }));
    renderWithProviders(<BrandMark />);

    expect(await screen.findByTestId('tenant-brand-name')).toHaveTextContent('Akademia Samouka');
    expect(screen.queryByAltText('Together')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tenant-brand-logo')).not.toBeInTheDocument();
  });

  it('renders the compact checkout brand at the specified size', async () => {
    server.use(offerHandler(BRANDED));
    renderWithProviders(<BrandMark size="compact" />);

    expect(await screen.findByTestId('tenant-brand-logo')).toHaveStyle({ height: '1.5rem' });
  });

  it('falls back to the stock wordmark when the offer is not found', async () => {
    const requested = vi.fn();
    server.use(
      http.get('/api/public/offer', () => {
        requested();
        return HttpResponse.json(
          { ok: false, error: { code: 'tenant_not_found', message: 'Unknown tenant' } },
          { status: 404 },
        );
      }),
    );
    renderWithProviders(<BrandMark />);

    await waitFor(() => expect(requested).toHaveBeenCalledOnce());
    expect(screen.getByAltText('Together')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-brand-logo')).not.toBeInTheDocument();
  });

  it('keeps social profiles out of the brand slot', async () => {
    server.use(offerHandler(BRANDED, [
      { label: 'YouTube', url: 'https://youtube.com/@akademia' },
    ]));
    renderWithProviders(<BrandMark />);

    expect(await screen.findByTestId('tenant-brand-logo')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'YouTube' })).not.toBeInTheDocument();
  });
});

describe('TenantSocialLinks', () => {
  it('renders social profiles in a member page', async () => {
    server.use(offerHandler(BRANDED, [
      { label: 'Instagram', url: 'https://instagram.com/akademia' },
    ]));
    renderWithProviders(
      <MemberPage title="Moje kursy" eyebrow="biblioteka" breadcrumbLabel="Okruszki">
        <TenantSocialLinks />
      </MemberPage>,
    );

    expect(await screen.findByRole('navigation', { name: 'Profile społecznościowe' }))
      .toContainElement(screen.getByRole('link', { name: 'Instagram' }));
  });
});

describe('tenant logo variants', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    colorSchemePreference.save('auto');
  });

  it('renders the light variant on the light theme', async () => {
    matchMediaController();
    server.use(offerHandler(TWO_VARIANTS));
    renderThemed(<TenantLogo />);

    expect(await screen.findByTestId('tenant-logo')).toHaveAttribute(
      'src',
      '/assets/akademia-light.svg',
    );
  });

  it('renders the dark variant when the system prefers dark and the choice is auto', async () => {
    matchMediaController().setDark(true);
    server.use(offerHandler(TWO_VARIANTS));
    renderThemed(<TenantLogo />);

    expect(await screen.findByTestId('tenant-logo')).toHaveAttribute(
      'src',
      '/assets/akademia-dark.svg',
    );
  });

  it('follows a live OS change while the choice is auto', async () => {
    const media = matchMediaController();
    server.use(offerHandler(TWO_VARIANTS));
    renderThemed(<TenantLogo />);

    await screen.findByTestId('tenant-logo');
    act(() => media.setDark(true));

    expect(screen.getByTestId('tenant-logo')).toHaveAttribute('src', '/assets/akademia-dark.svg');
  });

  it('swaps the brand mark variant when the reader toggles the theme', async () => {
    matchMediaController();
    server.use(offerHandler(TWO_VARIANTS));
    renderThemed(<BrandMark />);

    expect(await screen.findByTestId('tenant-brand-logo')).toHaveAttribute(
      'src',
      '/assets/akademia-light.svg',
    );
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'ciemny' }));
    });

    expect(screen.getByTestId('tenant-brand-logo')).toHaveAttribute(
      'src',
      '/assets/akademia-dark.svg',
    );
  });

  it('keeps the single uploaded variant on both themes', async () => {
    const media = matchMediaController();
    server.use(offerHandler({ ...TWO_VARIANTS, logoDarkUrl: null }));
    renderThemed(<TenantLogo />);

    await screen.findByTestId('tenant-logo');
    act(() => media.setDark(true));

    expect(screen.getByTestId('tenant-logo')).toHaveAttribute('src', '/assets/akademia-light.svg');
  });

  it('promotes a dark-only logo to the light theme', async () => {
    matchMediaController();
    server.use(offerHandler({ ...TWO_VARIANTS, logoUrl: null }));
    renderThemed(<TenantLogo />);

    expect(await screen.findByTestId('tenant-logo')).toHaveAttribute(
      'src',
      '/assets/akademia-dark.svg',
    );
  });
});
