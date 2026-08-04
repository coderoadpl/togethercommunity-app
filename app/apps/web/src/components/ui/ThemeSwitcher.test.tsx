import { useTheme } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { pl } from '../../i18n/pl.js';
import { ThemeModeProvider } from '../../theme-mode.js';
import { ThemeSwitcher } from './ThemeSwitcher.js';

const ThemeProbe = () => {
  const theme = useTheme();
  return (
    <div data-testid="theme-probe">
      {theme.shape.borderRadius}:{theme.palette.background.default}:{theme.typography.fontFamily}
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
  await user.click(screen.getByRole('combobox', { name: pl.common.theme }));
  await user.click(await screen.findByRole('option', { name: label }));
};

describe('ThemeSwitcher', () => {
  it('defaults to the shadcn theme and switches to stock Material via the Autocomplete', async () => {
    const user = userEvent.setup();
    renderSwitcher();

    expect(screen.getByTestId('theme-selector')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: pl.common.theme })).toHaveValue('Shadcn');
    expect(screen.getByTestId('theme-probe')).toHaveTextContent(/^8:#fafafa:'Inter'/);

    await selectMode(user, 'Material');

    expect(screen.getByTestId('theme-probe')).toHaveTextContent(/^4:.*Roboto/);
    expect(screen.getByRole('combobox', { name: pl.common.theme })).toHaveValue('Material');
  });

  it('offers every registered mode and applies the scoreboard theme', async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole('combobox', { name: pl.common.theme }));
    const labels = (await screen.findAllByRole('option')).map((option) => option.textContent);
    expect(labels).toEqual([
      'Logbook',
      'Material',
      'Quiet Studio',
      'Scoreboard',
      'Shadcn',
      'Signal Mono',
      'Steady Frame',
    ]);

    await user.click(screen.getByRole('option', { name: 'Scoreboard' }));

    expect(screen.getByTestId('theme-probe')).toHaveTextContent(/^8:#F7F5F2:'Inter'/);
    expect(screen.getByRole('combobox', { name: pl.common.theme })).toHaveValue('Scoreboard');
  });

  it('applies the quiet-studio theme when selected', async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await selectMode(user, 'Quiet Studio');

    expect(screen.getByTestId('theme-probe')).toHaveTextContent(/^10:#FAFAF8:'Inter'/);
    expect(screen.getByRole('combobox', { name: pl.common.theme })).toHaveValue('Quiet Studio');
  });

  it('restores the persisted mode on a fresh mount', async () => {
    const user = userEvent.setup();
    const first = renderSwitcher();
    await selectMode(user, 'Signal Mono');
    expect(screen.getByRole('combobox', { name: pl.common.theme })).toHaveValue('Signal Mono');
    first.unmount();

    renderSwitcher();
    expect(screen.getByRole('combobox', { name: pl.common.theme })).toHaveValue('Signal Mono');
    expect(screen.getByTestId('theme-probe')).toHaveTextContent(/^4:/);
  });
});
