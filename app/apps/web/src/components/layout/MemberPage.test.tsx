import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MemberPage } from './MemberPage.js';

describe('MemberPage', () => {
  it('renders the ledger header with title, eyebrow, nav and children', () => {
    render(
      <MemberPage
        title="Moje kursy"
        eyebrow="biblioteka kursów"
        breadcrumbLabel="Okruszki"
        nav={<a href="/my/products">Moje produkty</a>}
        data-testid="page"
      >
        <p>Siatka kursów</p>
      </MemberPage>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Moje kursy' })).toBeInTheDocument();
    expect(screen.getByText('biblioteka kursów')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Moje produkty' })).toBeInTheDocument();
    expect(screen.getByText('Siatka kursów')).toBeInTheDocument();
  });

  it('renders breadcrumbs with links and a current-page item', () => {
    render(
      <MemberPage
        title="Deklarowanie zmiennych"
        eyebrow="lekcja"
        breadcrumbLabel="Okruszki"
        breadcrumbs={[
          { label: 'Kurs JS', link: <a href="/my/courses/course-js">Kurs JS</a> },
          { label: 'Deklarowanie zmiennych' },
        ]}
      />,
    );

    expect(screen.getByLabelText('Okruszki')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kurs JS' })).toHaveAttribute(
      'href',
      '/my/courses/course-js',
    );
  });

  it('renders the rail alongside the content', () => {
    render(
      <MemberPage title="Kurs" eyebrow="program kursu" breadcrumbLabel="Okruszki" rail={<aside>Postęp</aside>}>
        <p>Opis kursu</p>
      </MemberPage>,
    );

    expect(screen.getByText('Postęp')).toBeInTheDocument();
    expect(screen.getByText('Opis kursu')).toBeInTheDocument();
  });

  it('splits leading and trailing rail content around the main column on mobile', () => {
    render(
      <MemberPage
        title="Kurs"
        eyebrow="program kursu"
        breadcrumbLabel="Okruszki"
        mobileRail="split"
        railLeading={<div>Postęp</div>}
        rail={<div>Program</div>}
      >
        <p>Opis kursu</p>
      </MemberPage>,
    );

    expect(screen.getByTestId('member-rail-leading')).toHaveTextContent('Postęp');
    expect(screen.getByRole('main')).toHaveTextContent('Opis kursu');
    expect(screen.getByTestId('member-rail-trailing')).toHaveTextContent('Program');
    expect(screen.getAllByText('Postęp')).toHaveLength(1);
    expect(screen.getAllByText('Program')).toHaveLength(1);
  });

  it('renders a StatusView inside the skeleton instead of children for non-ready states', () => {
    render(
      <MemberPage
        title="Moje kursy"
        eyebrow="biblioteka"
        breadcrumbLabel="Okruszki"
        state={{ kind: 'loading', label: 'Wczytywanie kursów…' }}
      >
        <p>Nie powinno się pojawić</p>
      </MemberPage>,
    );

    expect(screen.getByText('Wczytywanie kursów…')).toBeInTheDocument();
    expect(screen.queryByText('Nie powinno się pojawić')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Moje kursy' })).toBeInTheDocument();
  });

  it('renders the bottom tab bar slot inside a fixed nav landmark', () => {
    render(
      <MemberPage title="Moje kursy" eyebrow="biblioteka" breadcrumbLabel="Okruszki" bottomNav={<div>Zakładki</div>}>
        <p>Treść</p>
      </MemberPage>,
    );

    const bottomNav = screen.getByTestId('member-bottom-nav');
    expect(bottomNav.tagName).toBe('NAV');
    expect(bottomNav).toHaveTextContent('Zakładki');
  });

  it('omits the bottom nav container when no slot is passed', () => {
    render(
      <MemberPage title="Moje kursy" eyebrow="biblioteka" breadcrumbLabel="Okruszki">
        <p>Treść</p>
      </MemberPage>,
    );
    expect(screen.queryByTestId('member-bottom-nav')).not.toBeInTheDocument();
  });
});
