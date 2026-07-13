import { Autocomplete, Box, TextField } from '@mui/material';

import { useTranslations } from '../../i18n/index.js';
import { useThemeMode } from '../../theme-mode.js';
import { MODES } from '../../theme.js';
import { useGlobalChromeSuppressed } from './app-chrome.js';

export const ThemeSwitcher = ({ inline = false }: { inline?: boolean }) => {
  const { mode, setMode } = useThemeMode();
  const t = useTranslations();
  const suppressed = useGlobalChromeSuppressed();

  if (!inline && suppressed) return null;

  const selector = (
    <Autocomplete
      data-testid="theme-selector"
      size="small"
      disableClearable
      options={MODES}
      value={MODES.find((option) => option.id === mode) ?? MODES[0]}
      isOptionEqualToValue={(option, selected) => option.id === selected.id}
      getOptionLabel={(option) => option.label}
      onChange={(_event, option) => setMode(option.id)}
      renderInput={(params) => <TextField {...params} label={t.common.theme} />}
    />
  );

  if (inline) return <Box sx={{ width: 168 }}>{selector}</Box>;

  return (
    <Box sx={{ position: 'fixed', top: 10, right: 12, zIndex: (t) => t.zIndex.appBar, width: 190 }}>
      {selector}
    </Box>
  );
};
