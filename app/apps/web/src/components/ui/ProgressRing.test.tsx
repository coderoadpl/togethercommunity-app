import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressRing } from './ProgressRing.js';

const dashOffset = (element: Element) => Number(element.getAttribute('stroke-dashoffset'));
const dashArray = (element: Element) => Number(element.getAttribute('stroke-dasharray'));

describe('ProgressRing', () => {
  it('leaves the full circumference uncovered at zero', () => {
    render(<ProgressRing value={0} />);

    const arc = screen.getByTestId('progress-ring-value');
    expect(dashOffset(arc)).toBeCloseTo(dashArray(arc));
  });

  it('covers the whole circumference at a hundred percent', () => {
    render(<ProgressRing value={100} />);

    expect(dashOffset(screen.getByTestId('progress-ring-value'))).toBeCloseTo(0);
  });

  it('clamps values outside the percentage range', () => {
    const { rerender } = render(<ProgressRing value={-40} />);
    const belowRange = dashOffset(screen.getByTestId('progress-ring-value'));

    rerender(<ProgressRing value={0} />);
    expect(belowRange).toBeCloseTo(dashOffset(screen.getByTestId('progress-ring-value')));

    rerender(<ProgressRing value={140} />);
    expect(dashOffset(screen.getByTestId('progress-ring-value'))).toBeCloseTo(0);
  });

  it('flags the done state and stays out of the accessibility tree', () => {
    render(<ProgressRing value={100} done />);

    const ring = screen.getByTestId('progress-ring');
    expect(ring).toHaveAttribute('data-done', 'true');
    expect(ring).toHaveAttribute('aria-hidden');
  });

  it('scales the drawn circle with the requested size', () => {
    render(<ProgressRing value={50} size={40} />);

    expect(screen.getByTestId('progress-ring')).toHaveAttribute('viewBox', '0 0 40 40');
    expect(screen.getByTestId('progress-ring-value')).toHaveAttribute('r', '19');
  });
});
