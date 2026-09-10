import '@fontsource/fraunces/latin-400.css';
import '@fontsource/fraunces/latin-500.css';
import '@fontsource/fraunces/latin-600.css';
import '@fontsource/fraunces/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-ext-500.css';
import '@fontsource/inter/latin-ext-600.css';
import '@fontsource/inter/latin-ext-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/latin-ext-400.css';
import '@fontsource/manrope/latin-ext-500.css';
import '@fontsource/manrope/latin-ext-600.css';
import '@fontsource/manrope/latin-ext-700.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
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
  if (context.parameters['fixture'] !== undefined || context.parameters['serverHtml'] === true) return <Story />;
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
        boundary: { name: 'Layout boundary 1024', styles: { width: '1024px', height: '900px' }, type: 'desktop' },
        'mobile-375': { name: 'Mobile 375×812', styles: { width: '375px', height: '812px' }, type: 'mobile' },
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
