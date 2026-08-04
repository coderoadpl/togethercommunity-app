import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { BrandMark, TenantLogo, TenantSocialLinks } from './branding.js';
import { MemberPage } from './components/layout/index.js';
import { renderWithProviders } from './test/render.js';
import { server } from './test/server.js';

const offerHandler = (
  branding: { logoUrl: string | null; accentColor: string | null; faviconUrl: string | null },
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
  accentColor: '#0E7490',
  faviconUrl: '/assets/akademia-logo.svg',
};

describe('TenantLogo', () => {
  it('renders the tenant logo in the member header slot', async () => {
    server.use(offerHandler(BRANDED));
    renderWithProviders(
      <MemberPage title="Moje kursy" eyebrow="biblioteka" logo={<TenantLogo />} />,
    );

    const logo = await screen.findByTestId('tenant-logo');
    expect(logo).toHaveAttribute('src', '/assets/akademia-logo.svg');
    expect(logo).toHaveAttribute('alt', 'Akademia Samouka');
    expect(logo.closest('header')).not.toBeNull();
  });

  it('renders the tenant name without a logo', async () => {
    server.use(offerHandler({ logoUrl: null, accentColor: null, faviconUrl: null }));
    renderWithProviders(
      <MemberPage title="Moje kursy" eyebrow="biblioteka" logo={<TenantLogo />} />,
    );

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
    server.use(offerHandler({ logoUrl: null, accentColor: null, faviconUrl: null }));
    renderWithProviders(<BrandMark />);

    expect(await screen.findByTestId('tenant-brand-name')).toHaveTextContent('Akademia Samouka');
    expect(screen.queryByAltText('Together')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tenant-brand-logo')).not.toBeInTheDocument();
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
      <MemberPage title="Moje kursy" eyebrow="biblioteka">
        <TenantSocialLinks />
      </MemberPage>,
    );

    expect(await screen.findByRole('navigation', { name: 'Profile społecznościowe' }))
      .toContainElement(screen.getByRole('link', { name: 'Instagram' }));
  });
});
