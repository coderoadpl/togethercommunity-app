import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from '#core/domain/index.js';

import { languagePreference } from '../theme-mode.js';
import { en } from './en.js';
import type { Messages } from './messages.js';
import { pl } from './pl.js';

const dictionaries: Record<Language, Messages> = { pl, en };

export const languageOptions: readonly Language[] = LANGUAGES;

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Messages;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => undefined,
  t: dictionaries[DEFAULT_LANGUAGE],
});

export const useLanguage = () => useContext(LanguageContext);

/** Direct-access dictionary for the active language (e.g. `t.checkout.submitIdle`). */
export const useTranslations = (): Messages => useContext(LanguageContext).t;

/** Holds the language choice (persisted via the theme-mode storage helper). */
export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguage] = useState<Language>(languagePreference.load);

  useEffect(() => {
    languagePreference.save(language);
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, t: dictionaries[language] }),
    [language],
  );

  return <LanguageContext value={value}>{children}</LanguageContext>;
};
