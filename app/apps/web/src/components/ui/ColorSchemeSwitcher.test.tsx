import { useTheme } from '@mui/material/styles';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '../../i18n/index.js';
import { colorSchemePreference, ThemeModeProvider } from '../../theme-mode.js';
import { ColorSchemeSwitcher } from './ColorSchemeSwitcher.js';

const ThemeProbe = () => {
  const theme = useTheme();
  return <span data-testid="scheme-probe">{theme.palette.mode}</span>;
};

const matchMediaController = () => {
  let dark = false;
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const media = {
    get matches() {
      return dark;
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener);
    },
    dispatchEvent: () => true,
  };
  vi.stubGlobal('matchMedia', () => media);
  return {
    setDark: (value: boolean) => {
      dark = value;
      const event = new Event('change');
      Object.defineProperty(event, 'matches', { value });
      for (const listener of listeners) {
        if (typeof listener === 'function') listener(event);
        else listener.handleEvent(event);
      }
    },
  };
};

const renderSwitcher = () => render(
  <ThemeModeProvider>
    <LanguageProvider>
      <ColorSchemeSwitcher />
      <ThemeProbe />
    </LanguageProvider>
  </ThemeModeProvider>,
);

afterEach(() => vi.unstubAllGlobals());

describe('ColorSchemeSwitcher', () => {
  it('persists explicit choices and updates the theme', async () => {
    matchMediaController();
    const user = userEvent.setup();
    renderSwitcher();

    expect(screen.getByTestId('scheme-probe')).toHaveTextContent('light');
    expect(screen.getByRole('button', { name: 'Jasny' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ciemny' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auto' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ciemny' }));

    expect(screen.getByTestId('scheme-probe')).toHaveTextContent('dark');
    expect(colorSchemePreference.load()).toBe('dark');
  });

  it('follows live OS changes while Auto is selected', () => {
    const media = matchMediaController();
    renderSwitcher();

    expect(screen.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('scheme-probe')).toHaveTextContent('light');
    act(() => media.setDark(true));
    expect(screen.getByTestId('scheme-probe')).toHaveTextContent('dark');
  });

  it('keeps an explicit choice when the OS scheme changes', () => {
    const media = matchMediaController();
    colorSchemePreference.save('light');
    renderSwitcher();

    expect(screen.getByRole('button', { name: 'Jasny' })).toHaveAttribute('aria-pressed', 'true');
    act(() => media.setDark(true));
    expect(screen.getByTestId('scheme-probe')).toHaveTextContent('light');
  });
});
