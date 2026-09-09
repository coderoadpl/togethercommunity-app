import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ListSection, ResponsiveTable } from './ListSection.js';

const toolbar = {
  search: <input aria-label="Search" />,
  filters: <span>Filters</span>,
  actions: <button type="button">Export CSV</button>,
};

describe('ListSection', () => {
  it('renders the toolbar, rows and pagination for a non-empty collection', () => {
    render(
      <ListSection
        title="Lessons"
        toolbar={toolbar}
        pagination={<span>Page 1</span>}
        isEmpty={false}
        empty={<p>No lessons</p>}
      >
        <ul>
          <li>Declaring variables</li>
        </ul>
      </ListSection>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Lessons' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    expect(screen.getByText('Declaring variables')).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(screen.queryByText('No lessons')).not.toBeInTheDocument();
  });

  it('shows only the empty branch (no toolbar) when the collection is empty', () => {
    render(
      <ListSection toolbar={toolbar} isEmpty empty={<p>No lessons</p>}>
        <ul>
          <li>Should not appear</li>
        </ul>
      </ListSection>,
    );

    expect(screen.getByText('No lessons')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search')).not.toBeInTheDocument();
    expect(screen.queryByText('Should not appear')).not.toBeInTheDocument();
  });

  it('keeps the toolbar and swaps rows for the no-matches message when filtered to zero', () => {
    render(
      <ListSection
        toolbar={toolbar}
        isEmpty={false}
        empty={<p>No lessons</p>}
        noMatches={<p>No search results</p>}
      >
        <ul>
          <li>Should not appear</li>
        </ul>
      </ListSection>,
    );

    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByText('No search results')).toBeInTheDocument();
    expect(screen.queryByText('Should not appear')).not.toBeInTheDocument();
  });
});

describe('ResponsiveTable', () => {
  it('wraps its table in a scroll container', () => {
    render(
      <ResponsiveTable data-testid="scroller">
        <table>
          <tbody>
            <tr>
              <td>cell</td>
            </tr>
          </tbody>
        </table>
      </ResponsiveTable>,
    );

    expect(screen.getByTestId('scroller')).toContainElement(screen.getByText('cell'));
  });
});
