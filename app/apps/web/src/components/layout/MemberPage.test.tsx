import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemberPage } from './MemberPage.js';
import { PAGE_WIDTH } from './widths.js';

const stubCompactViewport = () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
};

describe('MemberPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the ledger header with title, eyebrow and children', () => {
    render(
      <MemberPage
        title="Moje kursy"
        eyebrow="biblioteka kursów"
        breadcrumbLabel="Okruszki"
        data-testid="page"
      >
        <p>Siatka kursów</p>
      </MemberPage>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Moje kursy' })).toBeInTheDocument();
    expect(screen.getByText('biblioteka kursów')).toBeInTheDocument();
    expect(screen.getByText('Siatka kursów')).toBeInTheDocument();
  });

  it('renders no eyebrow slot when the screen does not pass one', () => {
    render(<MemberPage title="Konto" breadcrumbLabel="Okruszki" data-testid="page" />);

    const header = screen.getByRole('banner');
    expect(within(header).getByRole('heading', { level: 1, name: 'Konto' })).toBeInTheDocument();
    expect(within(header).queryAllByRole('paragraph')).toEqual([]);
  });

  it('gives every member screen the wide shell unless it asks for the reading column', () => {
    const wide = render(
      <MemberPage title="Start" breadcrumbLabel="Okruszki" data-testid="page" />,
    );
    expect(screen.getByTestId('page')).toHaveStyle({ maxWidth: PAGE_WIDTH.wide });
    wide.unmount();

    render(
      <MemberPage title="Lekcja" breadcrumbLabel="Okruszki" width="prose" data-testid="page" />,
    );
    expect(screen.getByTestId('page')).toHaveStyle({ maxWidth: PAGE_WIDTH.prose });
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

  it('keeps every ancestor and drops the current page on compact viewports', () => {
    stubCompactViewport();
    render(
      <MemberPage
        title="Nasłuchiwanie kliknięć"
        eyebrow="lekcja"
        breadcrumbLabel="Okruszki"
        breadcrumbs={[
          { label: 'Kurs JS', link: <a href="/my/courses/course-js">Kurs JS</a> },
          { label: '02 - DOM' },
          { label: 'Zdarzenia' },
          { label: 'Nasłuchiwanie kliknięć' },
        ]}
      />,
    );

    const crumbs = screen.getByLabelText('Okruszki');
    expect(within(crumbs).getByRole('link', { name: 'Kurs JS' })).toBeInTheDocument();
    expect(within(crumbs).getByText('02 - DOM')).toBeInTheDocument();
    expect(within(crumbs).getByText('Zdarzenia')).toBeInTheDocument();
    expect(within(crumbs).queryByText('Nasłuchiwanie kliknięć')).not.toBeInTheDocument();
  });

  it('keeps only the root crumb of a two-item trail on compact viewports', () => {
    stubCompactViewport();
    render(
      <MemberPage
        title="Kurs JS"
        eyebrow="kurs"
        breadcrumbLabel="Okruszki"
        breadcrumbs={[
          { label: 'Moje kursy', link: <a href="/my/courses">Moje kursy</a> },
          { label: 'Kurs JS' },
        ]}
      />,
    );

    const crumbs = screen.getByLabelText('Okruszki');
    expect(within(crumbs).getByRole('link', { name: 'Moje kursy' })).toBeInTheDocument();
    expect(within(crumbs).queryByText('Kurs JS')).not.toBeInTheDocument();
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
});
