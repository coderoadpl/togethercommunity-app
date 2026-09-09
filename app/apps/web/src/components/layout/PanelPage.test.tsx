import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PanelPage } from './PanelPage.js';

describe('PanelPage', () => {
  it('renders the quiet h1 header with description, action and children', () => {
    render(
      <PanelPage
        title="Products"
        description="Your workspace offer"
        action={<button type="button">New product</button>}
        data-testid="page"
      >
        <p>Product list</p>
      </PanelPage>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Products' })).toBeInTheDocument();
    expect(screen.getByText('Your workspace offer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New product' })).toBeInTheDocument();
    expect(screen.getByText('Product list')).toBeInTheDocument();
  });

  it('renders the back link on detail pages', () => {
    render(
      <PanelPage title="JS Course" backTo={<a href="/panel/courses">All courses</a>}>
        <p>Details</p>
      </PanelPage>,
    );

    expect(screen.getByRole('link', { name: 'All courses' })).toHaveAttribute(
      'href',
      '/panel/courses',
    );
  });

  it('renders a StatusView instead of children for non-ready states', () => {
    render(
      <PanelPage title="Members" state={{ kind: 'error', message: 'Could not load', retry: { label: 'Retry', onRetry: () => undefined } }}>
        <p>Should not appear</p>
      </PanelPage>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load');
    expect(screen.queryByText('Should not appear')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
  });
});
