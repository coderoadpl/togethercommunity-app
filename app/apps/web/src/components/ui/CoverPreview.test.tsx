import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CoverPreview } from './CoverPreview.js';

describe('CoverPreview', () => {
  it('shows a themed icon surface until the cover image loads', () => {
    render(<CoverPreview src="https://cdn.test/cover.jpg" label="Cover preview" testId="cover" />);

    const surface = screen.getByTestId('cover-surface');
    const image = screen.getByTestId('cover');
    expect(surface).toHaveAttribute('role', 'img');
    expect(surface.querySelector('svg')).not.toBeNull();

    fireEvent.load(image);

    expect(surface.querySelector('svg')).toBeNull();
  });

  it('restores the icon placeholder when the cover cannot load', () => {
    render(<CoverPreview src="https://cdn.test/missing.jpg" label="Cover preview" testId="cover" />);
    const surface = screen.getByTestId('cover-surface');
    const image = screen.getByTestId('cover');

    fireEvent.load(image);
    fireEvent.error(image);

    expect(surface.querySelector('svg')).not.toBeNull();
  });
});
