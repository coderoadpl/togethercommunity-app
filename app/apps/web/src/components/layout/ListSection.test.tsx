import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ListSection, ResponsiveTable } from './ListSection.js';

const toolbar = {
  search: <input aria-label="Szukaj" />,
  filters: <span>Filtry</span>,
  actions: <button type="button">Eksportuj CSV</button>,
};

describe('ListSection', () => {
  it('renders the toolbar, rows and pagination for a non-empty collection', () => {
    render(
      <ListSection
        title="Lekcje"
        toolbar={toolbar}
        pagination={<span>Strona 1</span>}
        isEmpty={false}
        empty={<p>Brak lekcji</p>}
      >
        <ul>
          <li>Deklarowanie zmiennych</li>
        </ul>
      </ListSection>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Lekcje' })).toBeInTheDocument();
    expect(screen.getByLabelText('Szukaj')).toBeInTheDocument();
    expect(screen.getByText('Filtry')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eksportuj CSV' })).toBeInTheDocument();
    expect(screen.getByText('Deklarowanie zmiennych')).toBeInTheDocument();
    expect(screen.getByText('Strona 1')).toBeInTheDocument();
    expect(screen.queryByText('Brak lekcji')).not.toBeInTheDocument();
  });

  it('shows only the empty branch (no toolbar) when the collection is empty', () => {
    render(
      <ListSection toolbar={toolbar} isEmpty empty={<p>Brak lekcji</p>}>
        <ul>
          <li>Nie powinno się pojawić</li>
        </ul>
      </ListSection>,
    );

    expect(screen.getByText('Brak lekcji')).toBeInTheDocument();
    expect(screen.queryByLabelText('Szukaj')).not.toBeInTheDocument();
    expect(screen.queryByText('Nie powinno się pojawić')).not.toBeInTheDocument();
  });

  it('keeps the toolbar and swaps rows for the no-matches message when filtered to zero', () => {
    render(
      <ListSection
        toolbar={toolbar}
        isEmpty={false}
        empty={<p>Brak lekcji</p>}
        noMatches={<p>Brak wyników wyszukiwania</p>}
      >
        <ul>
          <li>Nie powinno się pojawić</li>
        </ul>
      </ListSection>,
    );

    expect(screen.getByLabelText('Szukaj')).toBeInTheDocument();
    expect(screen.getByText('Brak wyników wyszukiwania')).toBeInTheDocument();
    expect(screen.queryByText('Nie powinno się pojawić')).not.toBeInTheDocument();
  });
});

describe('ResponsiveTable', () => {
  it('wraps its table in a scroll container', () => {
    render(
      <ResponsiveTable data-testid="scroller">
        <table>
          <tbody>
            <tr>
              <td>komórka</td>
            </tr>
          </tbody>
        </table>
      </ResponsiveTable>,
    );

    expect(screen.getByTestId('scroller')).toContainElement(screen.getByText('komórka'));
  });
});
