import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FieldDiffImage } from './FieldDiff.js';

describe('the field diff image', () => {
  it('shows the next address as an image after an earlier one failed on the same instance', () => {
    const { container, rerender } = render(<FieldDiffImage url="/api/public/assets/broken.png" failedNote="not shown" />);
    const broken = container.querySelector('img');
    if (broken === null) throw new Error('image missing');
    fireEvent.error(broken);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('not shown')).toBeInTheDocument();

    rerender(<FieldDiffImage url="/api/public/assets/working.png" failedNote="not shown" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/public/assets/working.png');
    expect(screen.queryByText('not shown')).toBeNull();
  });
});
