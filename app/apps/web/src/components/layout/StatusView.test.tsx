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
    render(<StatusView state={{ kind: 'loading', label: 'Loading...' }} data-testid="status" />);
    expect(screen.getByTestId('status')).toHaveTextContent('Loading...');
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the error message with a working retry action', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <StatusView
        state={{
          kind: 'error',
          message: 'Something went wrong',
          retry: { label: 'Try again', onRetry },
        }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).toHaveClass('MuiButton-fullWidth');
    await user.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state with icon, title, body and action', () => {
    render(
      <StatusView
        state={{
          kind: 'empty',
          icon: <svg data-testid="empty-icon" />,
          title: 'No courses',
          body: 'Courses will appear here.',
          action: <a href="/my/products">My products</a>,
        }}
        data-testid="empty-state"
      />,
    );

    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-state', 'empty');
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(screen.getByText('No courses')).toBeInTheDocument();
    expect(screen.getByText('Courses will appear here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My products' })).toHaveAttribute('href', '/my/products');
  });

  it('renders the not-found state', () => {
    render(
      <StatusView state={{ kind: 'not-found', title: 'Nothing here' }} data-testid="nf" />,
    );
    expect(screen.getByTestId('nf')).toHaveAttribute('data-state', 'not-found');
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('can render an empty state inside an existing surface', () => {
    render(
      <StatusView
        state={{ kind: 'empty', title: 'No data' }}
        surface={false}
        data-testid="inline-empty"
      />,
    );

    expect(screen.getByTestId('inline-empty')).toHaveAttribute('data-state', 'empty');
    expect(screen.getByTestId('inline-empty')).not.toHaveClass('MuiPaper-root');
    expect(screen.getByTestId('inline-empty').querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText('No data')).toHaveClass('MuiTypography-body2');
  });
});
