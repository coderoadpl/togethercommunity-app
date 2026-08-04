import { Stack, SvgIcon, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';

import { useTranslations } from '../../i18n/index.js';
import { COLOR_SCHEMES, useColorScheme, type ColorScheme } from '../../theme-mode.js';

const SchemeIcon = ({ scheme }: { scheme: ColorScheme }) => {
  switch (scheme) {
    case 'light':
      return (
        <SvgIcon fontSize="small" aria-hidden>
          <path d="M6.76 4.84 5.35 3.43 3.93 4.84l1.42 1.42 1.41-1.42ZM4 11H1v2h3v-2Zm9-10h-2v3h2V1Zm7.07 3.84-1.42-1.41-1.41 1.41 1.41 1.42 1.42-1.42ZM17.24 19.16l1.41 1.41 1.42-1.41-1.42-1.42-1.41 1.42ZM20 11v2h3v-2h-3ZM12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm-1 17h2v-3h-2v3ZM3.93 19.16l1.42 1.41 1.41-1.41-1.41-1.42-1.42 1.42Z" />
        </SvgIcon>
      );
    case 'dark':
      return (
        <SvgIcon fontSize="small" aria-hidden>
          <path d="M9.37 5.51A7 7 0 0 0 18.49 14.63 8 8 0 1 1 9.37 5.51Z" />
        </SvgIcon>
      );
    case 'auto':
      return (
        <SvgIcon fontSize="small" aria-hidden>
          <path d="M4 5h16v11H4V5Zm6 13h4v1h3v2H7v-2h3v-1Zm1-11v7h2V7h-2Z" />
        </SvgIcon>
      );
  }
};

export const ColorSchemeSwitcher = ({ compact = false }: { compact?: boolean }) => {
  const t = useTranslations();
  const { colorScheme, setColorScheme } = useColorScheme();
  const labels = t.common.colorScheme;

  return (
    <ToggleButtonGroup
      data-testid="color-scheme-switcher"
      size="small"
      exclusive
      value={colorScheme}
      aria-label={labels.label}
      sx={compact ? { '& .MuiToggleButton-root': { minHeight: '44px', minWidth: '44px', px: 0 } } : undefined}
      onChange={(_event, next: ColorScheme | null) => {
        if (next !== null) setColorScheme(next);
      }}
    >
      {COLOR_SCHEMES.map((scheme) => compact ? (
        <Tooltip key={scheme} title={labels[scheme]}>
          <ToggleButton value={scheme} aria-label={labels[scheme]}>
            <SchemeIcon scheme={scheme} />
          </ToggleButton>
        </Tooltip>
      ) : (
        <ToggleButton key={scheme} value={scheme} aria-label={labels[scheme]}>
          <Stack direction="row" useFlexGap spacing="0.35rem" sx={{ alignItems: 'center' }}>
            <SchemeIcon scheme={scheme} />
            <span>{labels[scheme]}</span>
          </Stack>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
};
