import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { CreatorOnboarding } from '#core/domain/index.js';

import { pl } from '../../i18n/pl.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { OnboardingChecklist } from './OnboardingChecklist.js';

const onboarding = (dismissed = false): CreatorOnboarding => ({
  steps: [
    { id: 'course_with_lesson', done: true, target: '/panel/courses/new' },
    { id: 'product_with_price', done: false, target: '/panel/products/new#prices' },
    { id: 'published_product', done: false, target: '/panel/products#product-actions' },
    { id: 'first_member', done: false, target: '/panel/members#invite-members' },
    { id: 'payments_configured', done: false, target: '/panel/integrations#payments' },
  ],
  dismissed,
});

describe('OnboardingChecklist', () => {
  it('shows progress and one linked row per step', async () => {
    server.use(
      http.get('/api/onboarding', () =>
        HttpResponse.json({ ok: true, data: { onboarding: onboarding() } }),
      ),
    );

    renderWithProviders(<OnboardingChecklist />);

    expect(await screen.findByTestId('onboarding-checklist')).toBeInTheDocument();
    expect(screen.getByText(pl.onboarding.title)).toBeInTheDocument();
    expect(screen.getByText(pl.onboarding.progress({ done: 1, total: 5 }))).toBeInTheDocument();
    expect(screen.getByText(pl.onboarding.steps.courseWithLesson)).toBeInTheDocument();
    expect(screen.getByText(pl.onboarding.steps.paymentsConfigured)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: new RegExp(pl.onboarding.stepOpen) })).toHaveLength(4);
  });

  it('renders nothing when the checklist was dismissed', async () => {
    server.use(
      http.get('/api/onboarding', () =>
        HttpResponse.json({ ok: true, data: { onboarding: onboarding(true) } }),
      ),
    );

    const { container } = renderWithProviders(<OnboardingChecklist />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('dismisses the checklist and hides the card', async () => {
    let dismissed = false;
    server.use(
      http.get('/api/onboarding', () =>
        HttpResponse.json({ ok: true, data: { onboarding: onboarding(dismissed) } }),
      ),
      http.post('/api/onboarding/dismiss', () => {
        dismissed = true;
        return HttpResponse.json({ ok: true, data: { onboarding: onboarding(true) } });
      }),
    );

    renderWithProviders(<OnboardingChecklist />);

    await userEvent.click(await screen.findByTestId('onboarding-dismiss'));

    await waitFor(() => expect(screen.queryByTestId('onboarding-checklist')).not.toBeInTheDocument());
    expect(dismissed).toBe(true);
  });
});
