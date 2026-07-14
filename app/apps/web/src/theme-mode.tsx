import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeProvider } from '@mui/material';

import { DEFAULT_LANGUAGE, languageSchema, type Language } from '@core/domain/index.js';

import { createThemeForMode, MODES, type ThemeMode } from './theme.js';

/**
 * The one module allowed to touch localStorage (see eslint boundary). Every
 * persisted UI preference goes through this helper so the storage surface stays
 * confined here.
 */
const persistedPreference = <T extends string>(
  key: string,
  isValid: (value: string | null) => value is T,
  fallback: T,
) => ({
  load: (): T => {
    try {
      const stored = localStorage.getItem(key);
      return isValid(stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  },
  save: (value: T): void => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // private mode etc. — the choice just won't persist
    }
  },
});

const isThemeMode = (value: string | null): value is ThemeMode =>
  MODES.some((option) => option.id === value);

const isLanguage = (value: string | null): value is Language =>
  value !== null && languageSchema.safeParse(value).success;

const themePreference = persistedPreference('together-theme-mode', isThemeMode, 'shadcn');

export const languagePreference = persistedPreference(
  'together-language',
  isLanguage,
  DEFAULT_LANGUAGE,
);

const ThemeModeContext = createContext<{ mode: ThemeMode; setMode: (mode: ThemeMode) => void }>({
  mode: 'shadcn',
  setMode: () => undefined,
});

export const useThemeMode = () => useContext(ThemeModeContext);

/** Holds the theme choice (persisted) and provides the root ThemeProvider. */
export const ThemeModeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState<ThemeMode>(themePreference.load);

  useEffect(() => {
    themePreference.save(mode);
  }, [mode]);

  const value = useMemo(() => ({ mode, setMode }), [mode]);
  const theme = useMemo(() => createThemeForMode(mode), [mode]);

  return (
    <ThemeModeContext value={value}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ThemeModeContext>
  );
};
