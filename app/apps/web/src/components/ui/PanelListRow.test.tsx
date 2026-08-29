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
        title="Klub JavaScriptu"
        badges={<span>Członkostwo</span>}
        actions={<button type="button">Zarządzaj</button>}
      />,
    );

    const row = screen.getByTestId('row');
    const order = row.textContent ?? '';
    expect(order.indexOf('Klub JavaScriptu')).toBeLessThan(order.indexOf('Członkostwo'));
    expect(order.indexOf('Członkostwo')).toBeLessThan(order.indexOf('Zarządzaj'));
  });

  it('renders meta above the row body', () => {
    render(
      <PanelListRow data-testid="row" title="Ogólna" meta={<span>3 wpisy</span>}>
        <span>Szczegóły</span>
      </PanelListRow>,
    );

    const order = screen.getByTestId('row').textContent ?? '';
    expect(order.indexOf('3 wpisy')).toBeLessThan(order.indexOf('Szczegóły'));
  });

  it('omits the meta and action containers when nothing is passed', () => {
    render(<PanelListRow title="Ogólna" data-testid="row" />);

    expect(screen.getByTestId('row').querySelectorAll('.MuiStack-root')).toHaveLength(2);
  });
});
