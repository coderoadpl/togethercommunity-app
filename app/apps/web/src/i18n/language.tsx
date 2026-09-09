import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from '#core/domain/index.js';

import { languagePreference } from '../theme-mode.js';
import { en } from './en.js';
import type { Messages } from './messages.js';
import { pl } from './pl.js';

const dictionaries: Record<Language, Messages> = { pl, en };

export const languageOptions: readonly Language[] = LANGUAGES;

interface LanguageContextValue {
  language: Language;
  explicitLanguage: Language | undefined;
  setLanguage: (language: Language) => void;
  setTenantDefaultLanguage: (language: Language) => void;
  t: Messages;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: DEFAULT_LANGUAGE,
  explicitLanguage: undefined,
  setLanguage: () => undefined,
  setTenantDefaultLanguage: () => undefined,
  t: dictionaries[DEFAULT_LANGUAGE],
});

export const useLanguage = () => useContext(LanguageContext);

/** Direct-access dictionary for the active language (e.g. `t.checkout.submitIdle`). */
export const useTranslations = (): Messages => useContext(LanguageContext).t;

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [initialExplicitLanguage] = useState<Language | undefined>(languagePreference.loadStored);
  const [language, setLanguageState] = useState<Language>(() => initialExplicitLanguage ?? DEFAULT_LANGUAGE);
  const [explicitLanguage, setExplicitLanguage] = useState<Language | undefined>(initialExplicitLanguage);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    setExplicitLanguage(next);
    languagePreference.save(next);
  }, []);

  const setTenantDefaultLanguage = useCallback((next: Language) => {
    if (explicitLanguage === undefined) setLanguageState(next);
  }, [explicitLanguage]);

  const value = useMemo<LanguageContextValue>(
    () => ({ language, explicitLanguage, setLanguage, setTenantDefaultLanguage, t: dictionaries[language] }),
    [explicitLanguage, language, setLanguage, setTenantDefaultLanguage],
  );

  return <LanguageContext value={value}>{children}</LanguageContext>;
};
