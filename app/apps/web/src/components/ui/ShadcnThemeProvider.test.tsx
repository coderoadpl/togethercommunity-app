import { useTheme } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ThemeModeProvider } from '../../theme-mode.js';

const ThemeProbe = () => {
  const theme = useTheme();
  return (
    <div data-testid="theme-probe">
      {theme.palette.mode}:{theme.shape.borderRadius}:{theme.palette.background.default}:
      {theme.typography.fontFamily}
    </div>
  );
};

describe('ThemeModeProvider', () => {
  it('provides the warm light Shadcn theme by default', () => {
    render(
      <ThemeModeProvider>
        <ThemeProbe />
      </ThemeModeProvider>,
    );

    expect(screen.getByTestId('theme-probe')).toHaveTextContent(/^light:8:#FAFAF9:'Inter'/);
  });
});
