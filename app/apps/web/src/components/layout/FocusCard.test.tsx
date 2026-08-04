import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FocusCard } from './FocusCard.js';

describe('FocusCard', () => {
  it('renders the default Together wordmark, eyebrow and children', () => {
    render(
      <FocusCard eyebrow="logowanie · studio" data-testid="card">
        <p>Pola formularza</p>
      </FocusCard>,
    );

    expect(screen.getByAltText('Together')).toBeInTheDocument();
    expect(screen.getByText('logowanie · studio')).toBeInTheDocument();
    expect(screen.getByText('Pola formularza')).toBeInTheDocument();
  });

  it('lets a caller replace the brand slot', () => {
    render(
      <FocusCard eyebrow="404" brand={<h1>Inna marka</h1>}>
        <p>Treść</p>
      </FocusCard>,
    );

    expect(screen.queryByAltText('Together')).not.toBeInTheDocument();
    expect(screen.getByText('Inna marka')).toBeInTheDocument();
  });

  it('renders the footer after a divider', () => {
    render(
      <FocusCard eyebrow="rejestracja" footer={<p>Masz już konto?</p>}>
        <p>Treść</p>
      </FocusCard>,
    );

    expect(screen.getByText('Masz już konto?')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('omits the divider when there is no footer', () => {
    render(
      <FocusCard eyebrow="rejestracja">
        <p>Treść</p>
      </FocusCard>,
    );
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('renders as a form and submits when onSubmit is provided', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <FocusCard eyebrow="logowanie" onSubmit={onSubmit} data-testid="card">
        <button type="submit">Zaloguj się</button>
      </FocusCard>,
    );

    expect(screen.getByTestId('card').tagName).toBe('FORM');
    await user.click(screen.getByRole('button', { name: 'Zaloguj się' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
