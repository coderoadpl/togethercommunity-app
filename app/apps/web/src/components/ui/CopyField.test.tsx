import type { ReactElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '../../i18n/index.js';
import { pl } from '../../i18n/pl.js';
import { stylesAt } from '../../lib/stylesheet.js';
import { CopyField } from './CopyField.js';

const setClipboard = (clipboard: unknown) => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
};

const acceptingClipboard = () => {
  const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
  setClipboard({ writeText });
  return writeText;
};

const renderField = (ui: ReactElement) => render(<LanguageProvider>{ui}</LanguageProvider>);

const clickCopy = () => fireEvent.click(screen.getByRole('button', { name: pl.copyField.copy }));

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('CopyField', () => {
  it('writes the value to the clipboard and shows the copied state', async () => {
    const writeText = acceptingClipboard();
    renderField(<CopyField value="cname.example.test" label="Value" testId="dns-value" />);

    clickCopy();

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('cname.example.test'));
    expect(screen.getByTestId('dns-value-copied')).toHaveTextContent(pl.copyField.copied);
  });

  it('clears the copied state once the feedback window passes', async () => {
    vi.useFakeTimers();
    acceptingClipboard();
    renderField(<CopyField value="cname.example.test" testId="dns-value" />);

    clickCopy();
    await act(() => Promise.resolve());
    expect(screen.getByTestId('dns-value-copied')).toHaveTextContent(pl.copyField.copied);

    await act(() => vi.advanceTimersByTimeAsync(2_000));

    expect(screen.getByTestId('dns-value-copied')).toHaveTextContent('');
  });

  it('renders selectable code by default and an editable textbox on request', () => {
    const onChange = vi.fn();
    const { rerender } = renderField(<CopyField value="fixed" testId="field" />);

    const text = screen.getByTestId('field');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(text.tagName).toBe('CODE');
    expect(text).toHaveTextContent('fixed');
    expect(text).not.toHaveAttribute('tabindex');
    expect(stylesAt(text, 390)).toMatchObject({
      'font-family': expect.stringContaining('monospace'),
      'user-select': 'text',
      'white-space': 'pre-wrap',
      'overflow-wrap': 'anywhere',
      'min-width': '0px',
    });

    rerender(
      <LanguageProvider>
        <CopyField value="fixed" editable onChange={onChange} testId="field" />
      </LanguageProvider>,
    );

    expect(screen.getByRole('textbox')).toBe(screen.getByTestId('field'));
    expect(screen.getByRole('textbox')).not.toHaveAttribute('readonly');
    fireEvent.change(screen.getByTestId('field'), { target: { value: 'edited' } });
    expect(onChange).toHaveBeenCalledWith('edited');
  });

  it('keeps the label and hint associated and the copy button keyboard accessible', async () => {
    const user = userEvent.setup();
    const writeText = acceptingClipboard();
    renderField(<CopyField value="fixed" label="Value" hint="Copy this value" testId="field" size="small" />);

    const group = screen.getByRole('group', { name: 'Value' });
    expect(group).toHaveAccessibleDescription('Copy this value');
    const button = screen.getByRole('button', { name: pl.copyField.copy });
    expect(stylesAt(button, 390)).toMatchObject({ 'min-width': '44px', 'min-height': '44px' });

    await user.click(screen.getByTestId('field'));
    expect(screen.getByTestId('field')).not.toHaveFocus();
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(writeText).toHaveBeenCalledWith('fixed');
  });

  it('still selects the editable input when the clipboard is unavailable', async () => {
    setClipboard(undefined);
    const select = vi.spyOn(HTMLInputElement.prototype, 'select');
    renderField(<CopyField value="editable" editable />);

    clickCopy();

    await waitFor(() => expect(select).toHaveBeenCalled());
  });

  it('selects the text when the Clipboard API is unavailable', async () => {
    setClipboard(undefined);
    renderField(<CopyField value="no-clipboard" testId="field" />);

    clickCopy();

    await waitFor(() => expect(window.getSelection()?.toString()).toBe(screen.getByTestId('field').textContent));
    expect(screen.getByTestId('field-copied')).toHaveTextContent('');
  });

  it('selects the text when the clipboard write is rejected', async () => {
    setClipboard({
      writeText: vi.fn<(value: string) => Promise<void>>().mockRejectedValue(new Error('denied')),
    });
    renderField(<CopyField value="denied" testId="field" />);

    clickCopy();

    await waitFor(() => expect(window.getSelection()?.toString()).toBe(screen.getByTestId('field').textContent));
    expect(screen.getByTestId('field-copied')).toHaveTextContent('');
  });
});
