import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { StatusView } from './StatusView.js';

describe('StatusView', () => {
  it('renders nothing for the ready state', () => {
    const { container } = render(<StatusView state={{ kind: 'ready' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the loading label', () => {
    render(<StatusView state={{ kind: 'loading', label: 'Wczytywanie…' }} data-testid="status" />);
    expect(screen.getByTestId('status')).toHaveTextContent('Wczytywanie…');
  });

  it('renders the error message with a working retry action', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <StatusView
        state={{
          kind: 'error',
          message: 'Coś poszło nie tak',
          retry: { label: 'Spróbuj ponownie', onRetry },
        }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Coś poszło nie tak');
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the error message without a retry button when no retry is given', () => {
    render(<StatusView state={{ kind: 'error', message: 'Błąd' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Błąd');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the empty state with icon, title, body and action', () => {
    render(
      <StatusView
        state={{
          kind: 'empty',
          icon: <svg data-testid="empty-icon" />,
          title: 'Brak kursów',
          body: 'Kursy pojawią się tutaj.',
          action: <a href="/my/products">Moje produkty</a>,
        }}
        data-testid="empty-state"
      />,
    );

    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-state', 'empty');
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(screen.getByText('Brak kursów')).toBeInTheDocument();
    expect(screen.getByText('Kursy pojawią się tutaj.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Moje produkty' })).toHaveAttribute('href', '/my/products');
  });

  it('renders the not-found state', () => {
    render(
      <StatusView state={{ kind: 'not-found', title: 'Niczego tu nie ma' }} data-testid="nf" />,
    );
    expect(screen.getByTestId('nf')).toHaveAttribute('data-state', 'not-found');
    expect(screen.getByText('Niczego tu nie ma')).toBeInTheDocument();
  });
});
