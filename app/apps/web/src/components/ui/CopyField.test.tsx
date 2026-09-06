import type { ReactElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '../../i18n/index.js';
import { pl } from '../../i18n/pl.js';
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('CopyField', () => {
  it('writes the value to the clipboard and shows the copied state', async () => {
    const writeText = acceptingClipboard();
    renderField(<CopyField value="cname.example.test" label="Wartość" testId="dns-value" />);

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

  it('renders a read-only input by default and an editable one on request', () => {
    const onChange = vi.fn();
    const { rerender } = renderField(<CopyField value="fixed" testId="field" />);

    expect(screen.getByTestId('field')).toHaveAttribute('readonly');

    rerender(
      <LanguageProvider>
        <CopyField value="fixed" editable onChange={onChange} testId="field" />
      </LanguageProvider>,
    );

    expect(screen.getByTestId('field')).not.toHaveAttribute('readonly');
    fireEvent.change(screen.getByTestId('field'), { target: { value: 'edited' } });
    expect(onChange).toHaveBeenCalledWith('edited');
  });

  it('selects the text when the Clipboard API is unavailable', async () => {
    setClipboard(undefined);
    const select = vi.spyOn(HTMLInputElement.prototype, 'select');
    renderField(<CopyField value="no-clipboard" testId="field" />);

    clickCopy();

    await waitFor(() => expect(select).toHaveBeenCalled());
    expect(screen.getByTestId('field-copied')).toHaveTextContent('');
  });

  it('selects the text when the clipboard write is rejected', async () => {
    setClipboard({
      writeText: vi.fn<(value: string) => Promise<void>>().mockRejectedValue(new Error('denied')),
    });
    const select = vi.spyOn(HTMLInputElement.prototype, 'select');
    renderField(<CopyField value="denied" testId="field" />);

    clickCopy();

    await waitFor(() => expect(select).toHaveBeenCalled());
    expect(screen.getByTestId('field-copied')).toHaveTextContent('');
  });
});
