import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FocusCard } from './FocusCard.js';

describe('FocusCard', () => {
  it('renders the default Together wordmark, eyebrow and children', () => {
    render(
      <FocusCard eyebrow="sign in studio" data-testid="card">
        <p>Form fields</p>
      </FocusCard>,
    );

    expect(screen.getByAltText('Together')).toBeInTheDocument();
    expect(screen.getByText('sign in studio')).toBeInTheDocument();
    expect(screen.getByText('Form fields')).toBeInTheDocument();
  });

  it('lets a caller replace the brand slot', () => {
    render(
      <FocusCard eyebrow="404" brand={<h1>Other brand</h1>}>
        <p>Content</p>
      </FocusCard>,
    );

    expect(screen.queryByAltText('Together')).not.toBeInTheDocument();
    expect(screen.getByText('Other brand')).toBeInTheDocument();
  });

  it('renders the footer after a divider', () => {
    render(
      <FocusCard eyebrow="registration" footer={<p>Already have an account?</p>}>
        <p>Content</p>
      </FocusCard>,
    );

    expect(screen.getByText('Already have an account?')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('omits the divider when there is no footer', () => {
    render(
      <FocusCard eyebrow="registration">
        <p>Content</p>
      </FocusCard>,
    );
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('renders as a form and submits when onSubmit is provided', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <FocusCard eyebrow="sign in" onSubmit={onSubmit} data-testid="card">
        <button type="submit">Sign in</button>
      </FocusCard>,
    );

    expect(screen.getByTestId('card').tagName).toBe('FORM');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
