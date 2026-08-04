import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PanelPage } from './PanelPage.js';

describe('PanelPage', () => {
  it('renders the quiet h1 header with description, action and children', () => {
    render(
      <PanelPage
        title="Produkty"
        description="Oferta twojej przestrzeni"
        action={<button type="button">Nowy produkt</button>}
        data-testid="page"
      >
        <p>Lista produktów</p>
      </PanelPage>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Produkty' })).toBeInTheDocument();
    expect(screen.getByText('Oferta twojej przestrzeni')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nowy produkt' })).toBeInTheDocument();
    expect(screen.getByText('Lista produktów')).toBeInTheDocument();
  });

  it('renders the back link on detail pages', () => {
    render(
      <PanelPage title="Kurs JS" backTo={{ label: '← wszystkie kursy', href: '/panel/courses' }}>
        <p>Szczegóły</p>
      </PanelPage>,
    );

    expect(screen.getByRole('link', { name: '← wszystkie kursy' })).toHaveAttribute(
      'href',
      '/panel/courses',
    );
  });

  it('renders a StatusView instead of children for non-ready states', () => {
    render(
      <PanelPage title="Uczestnicy" state={{ kind: 'error', message: 'Nie udało się wczytać', retry: { label: 'Ponów', onRetry: () => undefined } }}>
        <p>Nie powinno się pojawić</p>
      </PanelPage>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Nie udało się wczytać');
    expect(screen.queryByText('Nie powinno się pojawić')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Uczestnicy' })).toBeInTheDocument();
  });
});
