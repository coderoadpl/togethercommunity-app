import type { Decorator, Preview } from '@storybook/react-vite';
import { CssBaseline, GlobalStyles, ThemeProvider } from '@mui/material';

import { LanguageProvider } from '../apps/web/src/i18n/index.js';
import { createThemeForMode, MODES, type ThemeMode } from '../apps/web/src/theme.js';

const isThemeMode = (value: unknown): value is ThemeMode =>
  MODES.some((option) => option.id === value);

const deterministicStyles = (
  <GlobalStyles
    styles={{
      '*, *::before, *::after': {
        animationDuration: '0s !important',
        animationDelay: '0s !important',
        transitionDuration: '0s !important',
        transitionDelay: '0s !important',
        caretColor: 'transparent !important',
      },
    }}
  />
);

const withThemeAndLanguage: Decorator = (Story, context) => {
  const mode = isThemeMode(context.globals['theme']) ? context.globals['theme'] : 'shadcn';
  return (
    <ThemeProvider theme={createThemeForMode(mode)}>
      <CssBaseline />
      {deterministicStyles}
      <LanguageProvider>
        <Story />
      </LanguageProvider>
    </ThemeProvider>
  );
};

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true },
    viewport: {
      options: {
        mobile: { name: 'Mobile 390×844', styles: { width: '390px', height: '844px' }, type: 'mobile' },
        desktop: { name: 'Desktop 1440×900', styles: { width: '1440px', height: '900px' }, type: 'desktop' },
      },
    },
  },
  initialGlobals: {
    theme: 'shadcn',
    viewport: { value: 'desktop' },
  },
  globalTypes: {
    theme: {
      description: 'Theme mode (theme.ts MODES)',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        dynamicTitle: true,
        items: MODES.map((option) => ({ value: option.id, title: option.label })),
      },
    },
  },
  decorators: [withThemeAndLanguage],
};

export default preview;
