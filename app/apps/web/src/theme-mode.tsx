import type { ReactNode } from 'react';
import { ThemeProvider } from '@mui/material';

import { DEFAULT_LANGUAGE, languageSchema, type Language } from '#core/domain/index.js';

import { createThemeForMode } from './theme.js';

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

const isLanguage = (value: string | null): value is Language =>
  value !== null && languageSchema.safeParse(value).success;

export const languagePreference = persistedPreference(
  'together-language',
  isLanguage,
  DEFAULT_LANGUAGE,
);

const shadcnTheme = createThemeForMode('shadcn');

export const ThemeModeProvider = ({ children }: { children: ReactNode }) => {
  return <ThemeProvider theme={shadcnTheme}>{children}</ThemeProvider>;
};
