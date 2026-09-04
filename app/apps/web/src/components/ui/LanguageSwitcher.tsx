import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';

import { languageOptions, useLanguage, useTranslations, type Language } from '../../i18n/index.js';
import { useGlobalChromeSuppressed } from './app-chrome.js';

export const LanguageSwitcher = ({
  inline = false,
  onChange,
}: {
  inline?: boolean;
  onChange?: (language: Language) => void;
}) => {
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
        if (next === null) return;
        setLanguage(next);
        onChange?.(next);
      }}
      sx={{ '& .MuiToggleButton-root': { minHeight: '44px', minWidth: '44px' } }}
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
      sx={{ position: 'fixed', top: 10, right: 12, zIndex: (t) => t.zIndex.appBar }}
    >
      {group}
    </Box>
  );
};
