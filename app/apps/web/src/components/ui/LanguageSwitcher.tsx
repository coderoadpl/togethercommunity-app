import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';

import { languageOptions, useLanguage, useTranslations, type Language } from '../../i18n/index.js';
import { useGlobalChromeSuppressed } from './app-chrome.js';

export const LanguageSwitcher = ({ inline = false }: { inline?: boolean }) => {
  const { language, setLanguage } = useLanguage();
  const t = useTranslations();
  const suppressed = useGlobalChromeSuppressed();

  if (!inline && suppressed) return null;

  const group = (
    <ToggleButtonGroup
      data-testid="language-switcher"
      size="small"
      exclusive
      value={language}
      aria-label={t.common.language}
      onChange={(_event, next: Language | null) => {
        if (next) setLanguage(next);
      }}
    >
      {languageOptions.map((option) => (
        <ToggleButton key={option} value={option} aria-label={option}>
          {option.toUpperCase()}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );

  if (inline) return group;

  return (
    <Box
      role="region"
      aria-label={t.common.language}
      sx={{ position: 'fixed', top: 10, right: 214, zIndex: (t) => t.zIndex.appBar }}
    >
      {group}
    </Box>
  );
};
