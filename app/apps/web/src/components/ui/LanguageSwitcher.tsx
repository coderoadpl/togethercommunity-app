import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';

import { languageOptions, useLanguage, type Language } from '../../i18n/index.js';

export const LanguageSwitcher = () => {
  const { language, setLanguage } = useLanguage();
  return (
    <Box sx={{ position: 'fixed', top: 10, right: 214, zIndex: (t) => t.zIndex.appBar }}>
      <ToggleButtonGroup
        data-testid="language-switcher"
        size="small"
        exclusive
        value={language}
        aria-label="Language"
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
    </Box>
  );
};
