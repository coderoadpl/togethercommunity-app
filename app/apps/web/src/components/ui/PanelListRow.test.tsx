import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PanelListRow } from './PanelListRow.js';

describe('PanelListRow', () => {
  it('renders the title as the row heading', () => {
    render(<PanelListRow title="Launch Kit" data-testid="row" />);

    expect(screen.getByRole('heading', { level: 2, name: 'Launch Kit' })).toBeInTheDocument();
    expect(screen.getByTestId('row')).toBeInTheDocument();
  });

  it('places badges next to the title and actions after them', () => {
    render(
      <PanelListRow
        data-testid="row"
        title="JavaScript Club"
        badges={<span>Membership</span>}
        actions={<button type="button">Manage</button>}
      />,
    );

    const row = screen.getByTestId('row');
    const order = row.textContent ?? '';
    expect(order.indexOf('JavaScript Club')).toBeLessThan(order.indexOf("Membership"));
    expect(order.indexOf("Membership")).toBeLessThan(order.indexOf("Manage"));
  });

  it('renders meta above the row body', () => {
    render(
      <PanelListRow data-testid="row" title="General" meta={<span>3 posts</span>}>
        <span>Details</span>
      </PanelListRow>,
    );

    const order = screen.getByTestId('row').textContent ?? '';
    expect(order.indexOf('3 posts')).toBeLessThan(order.indexOf("Details"));
  });

  it('omits the meta and action containers when nothing is passed', () => {
    render(<PanelListRow title="General" data-testid="row" />);

    expect(screen.getByTestId('row').querySelectorAll('.MuiStack-root')).toHaveLength(2);
  });
});
