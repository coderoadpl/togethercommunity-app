import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SectionCard } from './SectionCard.js';

describe('SectionCard', () => {
  it('renders an h2 title, description, children and actions', () => {
    render(
      <SectionCard
        title="Account details"
        description="Email address and password"
        actions={<button type="button">Save</button>}
        data-testid="card"
      >
        <p>Form fields</p>
      </SectionCard>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Account details' })).toBeInTheDocument();
    expect(screen.getByText('Email address and password')).toBeInTheDocument();
    expect(screen.getByText('Form fields')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('renders as a form and submits when onSubmit is provided', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <SectionCard title="Integration" onSubmit={onSubmit} data-testid="card">
        <button type="submit">Test connection</button>
      </SectionCard>,
    );

    expect(screen.getByTestId('card').tagName).toBe('FORM');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
