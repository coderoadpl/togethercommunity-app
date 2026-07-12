import { useTheme } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { ThemeModeProvider } from '../../theme-mode.js';
import { ThemeSwitcher } from './ThemeSwitcher.js';

/**
 * Node >= 25 exposes a non-functional global localStorage (methods are
 * undefined without --localstorage-file) that shadows jsdom's working one in
 * vitest, so the persistence assertions need a real in-memory stand-in.
 */
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});
afterAll(() => vi.unstubAllGlobals());

const ThemeProbe = () => {
  const theme = useTheme();
  return (
    <div data-testid="theme-probe">
      {theme.shape.borderRadius}:{theme.typography.fontFamily}
    </div>
  );
};

const renderSwitcher = () =>
  render(
    <ThemeModeProvider>
      <ThemeSwitcher />
      <ThemeProbe />
    </ThemeModeProvider>,
  );

const selectMode = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
  await user.click(screen.getByRole('combobox', { name: 'Theme' }));
  await user.click(await screen.findByRole('option', { name: label }));
};

describe('ThemeSwitcher', () => {
  it('switches from the logbook theme to stock Material via the Autocomplete', async () => {
    const user = userEvent.setup();
    renderSwitcher();

    expect(screen.getByTestId('theme-selector')).toBeInTheDocument();
    expect(screen.getByTestId('theme-probe')).toHaveTextContent(/^0:/);

    await selectMode(user, 'Material');

    expect(screen.getByTestId('theme-probe')).toHaveTextContent(/^4:.*Roboto/);
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('Material');
  });

  it('offers every registered mode and applies the scoreboard theme', async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole('combobox', { name: 'Theme' }));
    const labels = (await screen.findAllByRole('option')).map((option) => option.textContent);
    expect(labels).toEqual([
      'Logbook',
      'Material',
      'Quiet Studio',
      'Scoreboard',
      'Signal Mono',
      'Steady Frame',
    ]);

    await user.click(screen.getByRole('option', { name: 'Scoreboard' }));

    expect(screen.getByTestId('theme-probe')).toHaveTextContent(/^8:'Inter'/);
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('Scoreboard');
  });

  it('applies the quiet-studio theme when selected', async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await selectMode(user, 'Quiet Studio');

    expect(screen.getByTestId('theme-probe')).toHaveTextContent(/^10:'Inter'/);
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('Quiet Studio');
  });

  it('restores the persisted mode on a fresh mount', async () => {
    const user = userEvent.setup();
    const first = renderSwitcher();
    await selectMode(user, 'Signal Mono');
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('Signal Mono');
    first.unmount();

    renderSwitcher();
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('Signal Mono');
    expect(screen.getByTestId('theme-probe')).toHaveTextContent(/^4:/);
  });
});
