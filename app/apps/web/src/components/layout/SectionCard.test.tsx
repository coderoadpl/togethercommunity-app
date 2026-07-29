import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SectionCard } from './SectionCard.js';

describe('SectionCard', () => {
  it('renders an h2 title, description, children and actions', () => {
    render(
      <SectionCard
        title="Dane konta"
        description="Adres e-mail i hasło"
        actions={<button type="button">Zapisz</button>}
        data-testid="card"
      >
        <p>Pola formularza</p>
      </SectionCard>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Dane konta' })).toBeInTheDocument();
    expect(screen.getByText('Adres e-mail i hasło')).toBeInTheDocument();
    expect(screen.getByText('Pola formularza')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zapisz' })).toBeInTheDocument();
  });

  it('renders as a form and submits when onSubmit is provided', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <SectionCard title="Integracja" onSubmit={onSubmit} data-testid="card">
        <button type="submit">Testuj połączenie</button>
      </SectionCard>,
    );

    expect(screen.getByTestId('card').tagName).toBe('FORM');
    await user.click(screen.getByRole('button', { name: 'Testuj połączenie' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
