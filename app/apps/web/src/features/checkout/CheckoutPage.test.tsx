import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { CheckoutPage } from './CheckoutPage.js';

const offerBody = {
  tenant: { slug: 'acme', name: 'Acme School' },
  contentVersion: 1,
  products: [
    {
      id: 'course-1',
      title: 'Intro Course',
      description: 'Start here.',
      priceCents: 4900,
      currency: 'PLN',
    },
  ],
};

describe('CheckoutPage', () => {
  it('loads the public offer and completes the simulated purchase flow', async () => {
    server.use(
      http.get('/api/public/offer', () => HttpResponse.json({ ok: true, data: offerBody })),
      http.post('/api/dev/simulate-purchase', () =>
        HttpResponse.json({
          ok: true,
          data: {
            memberId: 'm1',
            productId: 'course-1',
            alreadyOwned: false,
            magicLink: {
              email: 'buyer@together.dev',
              url: 'https://acme.test/magic',
              token: 'token-1',
            },
          },
        }),
      ),
    );

    renderWithProviders(<CheckoutPage productId="course-1" />);

    expect(await screen.findByRole('heading', { name: 'Intro Course' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(pl.checkout.emailLabel), 'buyer@together.dev');
    await userEvent.click(screen.getByRole('button', { name: pl.checkout.submitIdle }));

    const link = await screen.findByRole('link', { name: pl.checkout.openCourse });
    expect(link).toHaveAttribute('href', 'https://acme.test/magic');
    expect(screen.getByText(pl.checkout.productionNote)).toBeInTheDocument();
  });
});
