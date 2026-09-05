import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LogoImage, type LogoSurface } from './LogoImage.js';

const renderLogo = (surface: LogoSurface) => {
  render(
    <LogoImage
      surface={surface}
      src="/assets/wordmark.svg"
      alt="Akademia Samouka"
      data-testid="logo"
    />,
  );
  return screen.getByTestId('logo');
};

describe('LogoImage', () => {
  it('names the mark with the tenant name', () => {
    expect(renderLogo('sidebar')).toHaveAttribute('alt', 'Akademia Samouka');
  });

  it('stays inside its container instead of overflowing a wide wordmark', () => {
    expect(renderLogo('sidebar')).toHaveStyle({
      maxWidth: '100%',
      minWidth: '0px',
      objectFit: 'contain',
    });
  });

  it('scales both axes from the intrinsic ratio so a square mark keeps its size', () => {
    expect(renderLogo('card')).toHaveStyle({ width: 'auto', height: 'auto' });
  });

  it.each([
    ['sidebar', '2rem'],
    ['appbar', '1.25rem'],
    ['card', '2.5rem'],
    ['compact', '1.5rem'],
  ] as const)('caps the height of the %s surface at %s', (surface, maxHeight) => {
    expect(renderLogo(surface)).toHaveStyle({ maxHeight });
  });

  it('keeps the width constraint when a caller adds spacing', () => {
    render(
      <LogoImage
        surface="card"
        src="/assets/wordmark.svg"
        alt="Akademia Samouka"
        data-testid="spaced-logo"
        sx={{ mb: '0.45rem' }}
      />,
    );

    expect(screen.getByTestId('spaced-logo')).toHaveStyle({
      marginBottom: '0.45rem',
      maxWidth: '100%',
      maxHeight: '2.5rem',
    });
  });
});
