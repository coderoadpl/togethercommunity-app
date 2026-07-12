import { Autocomplete, Box, TextField } from '@mui/material';

import { useThemeMode } from '../../theme-mode.js';
import { MODES } from '../../theme.js';

export const ThemeSwitcher = () => {
  const { mode, setMode } = useThemeMode();
  return (
    <Box
      sx={{ position: 'fixed', top: 10, right: 12, zIndex: (t) => t.zIndex.appBar, width: 190 }}
    >
      <Autocomplete
        data-testid="theme-selector"
        size="small"
        disableClearable
        options={MODES}
        value={MODES.find((option) => option.id === mode) ?? MODES[0]}
        isOptionEqualToValue={(option, selected) => option.id === selected.id}
        getOptionLabel={(option) => option.label}
        onChange={(_event, option) => setMode(option.id)}
        renderInput={(params) => <TextField {...params} label="Theme" />}
      />
    </Box>
  );
};
