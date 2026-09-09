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
        title="My courses"
        eyebrow="course library"
        breadcrumbLabel="Breadcrumbs"
        data-testid="page"
      >
        <p>Course grid</p>
      </MemberPage>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'My courses' })).toBeInTheDocument();
    expect(screen.getByText('course library')).toBeInTheDocument();
    expect(screen.getByText('Course grid')).toBeInTheDocument();
  });

  it('renders no eyebrow slot when the screen does not pass one', () => {
    render(<MemberPage title="Account" breadcrumbLabel="Breadcrumbs" data-testid="page" />);

    const header = screen.getByRole('banner');
    expect(within(header).getByRole('heading', { level: 1, name: 'Account' })).toBeInTheDocument();
    expect(within(header).queryAllByRole('paragraph')).toEqual([]);
  });

  it('gives every member screen the wide shell unless it asks for the reading column', () => {
    const wide = render(
      <MemberPage title="Start" breadcrumbLabel="Breadcrumbs" data-testid="page" />,
    );
    expect(screen.getByTestId('page')).toHaveStyle({ maxWidth: PAGE_WIDTH.wide });
    wide.unmount();

    render(
      <MemberPage title="Lesson" breadcrumbLabel="Breadcrumbs" width="prose" data-testid="page" />,
    );
    expect(screen.getByTestId('page')).toHaveStyle({ maxWidth: PAGE_WIDTH.prose });
  });

  it('renders breadcrumbs with links and a current-page item', () => {
    render(
      <MemberPage
        title="Declaring variables"
        eyebrow="lesson"
        breadcrumbLabel="Breadcrumbs"
        breadcrumbs={[
          { label: 'JS Course', link: <a href="/my/courses/course-js">JS Course</a> },
          { label: 'Declaring variables' },
        ]}
      />,
    );

    expect(screen.getByLabelText('Breadcrumbs')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'JS Course' })).toHaveAttribute(
      'href',
      '/my/courses/course-js',
    );
  });

  it('keeps every ancestor and drops the current page on compact viewports', () => {
    stubCompactViewport();
    render(
      <MemberPage
        title="Listening for clicks"
        eyebrow="lesson"
        breadcrumbLabel="Breadcrumbs"
        breadcrumbs={[
          { label: 'JS Course', link: <a href="/my/courses/course-js">JS Course</a> },
          { label: '02 - DOM' },
          { label: 'Events' },
          { label: 'Listening for clicks' },
        ]}
      />,
    );

    const crumbs = screen.getByLabelText('Breadcrumbs');
    expect(within(crumbs).getByRole('link', { name: 'JS Course' })).toBeInTheDocument();
    expect(within(crumbs).getByText('02 - DOM')).toBeInTheDocument();
    expect(within(crumbs).getByText('Events')).toBeInTheDocument();
    expect(within(crumbs).queryByText('Listening for clicks')).not.toBeInTheDocument();
  });

  it('keeps only the root crumb of a two-item trail on compact viewports', () => {
    stubCompactViewport();
    render(
      <MemberPage
        title="JS Course"
        eyebrow="course"
        breadcrumbLabel="Breadcrumbs"
        breadcrumbs={[
          { label: 'My courses', link: <a href="/my/courses">My courses</a> },
          { label: 'JS Course' },
        ]}
      />,
    );

    const crumbs = screen.getByLabelText('Breadcrumbs');
    expect(within(crumbs).getByRole('link', { name: 'My courses' })).toBeInTheDocument();
    expect(within(crumbs).queryByText('JS Course')).not.toBeInTheDocument();
  });

  it('renders the rail alongside the content', () => {
    render(
      <MemberPage title="Course" eyebrow="course syllabus" breadcrumbLabel="Breadcrumbs" rail={<aside>Progress</aside>}>
        <p>Course description</p>
      </MemberPage>,
    );

    expect(screen.getByText('Progress')).toBeInTheDocument();
    expect(screen.getByText('Course description')).toBeInTheDocument();
  });

  it('splits leading and trailing rail content around the main column on mobile', () => {
    render(
      <MemberPage
        title="Course"
        eyebrow="course syllabus"
        breadcrumbLabel="Breadcrumbs"
        mobileRail="split"
        railLeading={<div>Progress</div>}
        rail={<div>Syllabus</div>}
      >
        <p>Course description</p>
      </MemberPage>,
    );

    expect(screen.getByTestId('member-rail-leading')).toHaveTextContent('Progress');
    expect(screen.getByRole('main')).toHaveTextContent('Course description');
    expect(screen.getByTestId('member-rail-trailing')).toHaveTextContent('Syllabus');
    expect(screen.getAllByText('Progress')).toHaveLength(1);
    expect(screen.getAllByText('Syllabus')).toHaveLength(1);
  });

  it('renders a StatusView inside the skeleton instead of children for non-ready states', () => {
    render(
      <MemberPage
        title="My courses"
        eyebrow="library"
        breadcrumbLabel="Breadcrumbs"
        state={{ kind: 'loading', label: 'Loading courses...' }}
      >
        <p>Should not appear</p>
      </MemberPage>,
    );

    expect(screen.getByText('Loading courses...')).toBeInTheDocument();
    expect(screen.queryByText('Should not appear')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'My courses' })).toBeInTheDocument();
  });
});
