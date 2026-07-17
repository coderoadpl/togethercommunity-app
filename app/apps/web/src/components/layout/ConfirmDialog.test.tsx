import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './ConfirmDialog.js';

const baseProps = {
  title: 'Usunąć lekcję?',
  body: <p>Tej operacji nie można cofnąć.</p>,
  confirmLabel: 'Usuń',
  cancelLabel: 'Anuluj',
};

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog {...baseProps} open={false} onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the title and consequence body when open', () => {
    render(<ConfirmDialog {...baseProps} open onConfirm={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Usunąć lekcję?' })).toBeInTheDocument();
    expect(screen.getByText('Tej operacji nie można cofnąć.')).toBeInTheDocument();
  });

  it('calls onConfirm on the destructive action', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...baseProps} open onConfirm={onConfirm} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Usuń' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on cancel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ConfirmDialog {...baseProps} open onConfirm={vi.fn()} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while pending', () => {
    render(
      <ConfirmDialog {...baseProps} open pending onConfirm={vi.fn()} onClose={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: 'Usuń' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Anuluj' })).toBeDisabled();
  });
});
