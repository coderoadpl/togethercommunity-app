import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeProvider } from '@mui/material';

import { DEFAULT_LANGUAGE, languageSchema, type Language } from '#core/domain/index.js';

import { createThemeForMode, type ResolvedColorScheme } from './theme.js';

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

export const persistedJsonPreference = <T,>(
  key: string,
  parse: (value: unknown) => T | undefined,
  fallback: T,
) => ({
  load: (): T => {
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) return fallback;
      const value: unknown = JSON.parse(stored);
      return parse(value) ?? fallback;
    } catch {
      return fallback;
    }
  },
  save: (value: T): void => {
    try {
      const serialized = JSON.stringify(value);
      if (serialized !== undefined) localStorage.setItem(key, serialized);
    } catch {}
  },
});

const isLanguage = (value: string | null): value is Language =>
  value !== null && languageSchema.safeParse(value).success;

export const languagePreference = persistedPreference(
  'together-language',
  isLanguage,
  DEFAULT_LANGUAGE,
);

export const COLOR_SCHEMES = ['light', 'dark', 'auto'] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

const isColorScheme = (value: string | null): value is ColorScheme =>
  value !== null && COLOR_SCHEMES.some((scheme) => scheme === value);

export const colorSchemePreference = persistedPreference(
  'together-color-scheme',
  isColorScheme,
  'auto',
);

interface ColorSchemeContextValue {
  colorScheme: ColorScheme;
  resolvedScheme: ResolvedColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
}

const ColorSchemeContext = createContext<ColorSchemeContextValue | null>(null);

const systemPrefersDark = (): boolean =>
  typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-color-scheme: dark)').matches;

export const useColorScheme = (): ColorSchemeContextValue => {
  const value = useContext(ColorSchemeContext);
  if (value === null) throw new Error('useColorScheme must be used within ThemeModeProvider');
  return value;
};

export const ThemeModeProvider = ({ children }: { children: ReactNode }) => {
  const [colorScheme, setStoredColorScheme] = useState<ColorScheme>(colorSchemePreference.load);
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    setPrefersDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const resolvedScheme: ResolvedColorScheme = colorScheme === 'auto'
    ? prefersDark ? 'dark' : 'light'
    : colorScheme;

  useEffect(() => {
    document.documentElement.style.backgroundColor = resolvedScheme === 'dark' ? '#141210' : '#FAF8F5';
    document.documentElement.style.colorScheme = resolvedScheme;
    const lightMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"][media="(prefers-color-scheme: light)"]');
    const darkMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]');
    if (lightMeta !== null) lightMeta.content = '#FAF8F5';
    if (darkMeta !== null) darkMeta.content = '#141210';
    if (colorScheme === 'auto' || (resolvedScheme === 'dark') === prefersDark) return;
    const activeMeta = prefersDark ? darkMeta : lightMeta;
    if (activeMeta !== null) activeMeta.content = resolvedScheme === 'dark' ? '#141210' : '#FAF8F5';
  }, [colorScheme, prefersDark, resolvedScheme]);

  const theme = useMemo(() => createThemeForMode('shadcn', undefined, resolvedScheme), [resolvedScheme]);
  const value = useMemo<ColorSchemeContextValue>(() => ({
    colorScheme,
    resolvedScheme,
    setColorScheme: (scheme) => {
      colorSchemePreference.save(scheme);
      setStoredColorScheme(scheme);
    },
  }), [colorScheme, resolvedScheme]);

  return (
    <ColorSchemeContext value={value}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ColorSchemeContext>
  );
};
