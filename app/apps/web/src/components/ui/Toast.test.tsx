import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '../../i18n/index.js';
import { pl } from '../../i18n/pl.js';
import { ToastProvider, useToast } from './Toast.js';

const ToastHarness = () => {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.success('Success message')}>Success</button>
      <button type="button" onClick={() => toast.error('Error message')}>Error</button>
      <button type="button" onClick={() => toast.info('Info message')}>Info</button>
      <button type="button" onClick={() => {
        toast.info('One');
        toast.info('Two');
        toast.info('Three');
        toast.info('Four');
      }}
      >
        Many
      </button>
    </>
  );
};

const renderHarness = () => render(
  <LanguageProvider>
    <ToastProvider>
      <ToastHarness />
    </ToastProvider>
  </LanguageProvider>,
);

const toastStack = () => screen.getByTestId('toast-stack');

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastProvider', () => {
  it('keeps only the newest three toasts', async () => {
    renderHarness();

    await userEvent.click(screen.getByRole('button', { name: 'Many' }));

    expect(within(toastStack()).queryByText('One')).not.toBeInTheDocument();
    expect(within(toastStack()).getByText('Two')).toBeInTheDocument();
    expect(within(toastStack()).getByText('Three')).toBeInTheDocument();
    expect(within(toastStack()).getByText('Four')).toBeInTheDocument();
  });

  it('uses success and error timers', async () => {
    vi.useFakeTimers();
    renderHarness();

    fireEvent.click(screen.getByRole('button', { name: 'Success' }));
    expect(screen.getByTestId(/^toast-success-/)).toHaveTextContent('Success message');
    await act(() => vi.advanceTimersByTime(4999));
    expect(within(toastStack()).getByText('Success message')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId(/^toast-success-/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Error' }));
    expect(screen.getByTestId(/^toast-error-/)).toHaveTextContent('Error message');
    await act(() => vi.advanceTimersByTime(7999));
    expect(within(toastStack()).getByText('Error message')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Error message')).not.toBeInTheDocument();
  });

  it('dismisses a toast from its action button', async () => {
    renderHarness();

    await userEvent.click(screen.getByRole('button', { name: 'Info' }));
    await userEvent.click(screen.getByRole('button', { name: `${pl.common.close}: Info message` }));

    expect(screen.queryByTestId(/^toast-info-/)).not.toBeInTheDocument();
  });
});
