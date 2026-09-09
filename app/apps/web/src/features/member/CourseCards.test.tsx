import { ThemeProvider } from '@mui/material/styles';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { createThemeForMode } from '../../theme.js';
import { CourseCard, type CourseCardCourse } from './CourseCards.js';

const course = (id: string, description: string): CourseCardCourse => ({
  id,
  name: `Course ${id}`,
  description,
  imageUrl: null,
});

const renderCards = async () => {
  const rootRoute = createRootRoute({
    component: () => (
      <ThemeProvider theme={createThemeForMode('shadcn', undefined, 'light')}>
        <CourseCard
          course={course('with-description', 'A long enough summary to grow the card.')}
          counts={{ accessibleLessonCount: 4, completedLessonCount: 1 }}
        />
        <CourseCard
          course={course('without-description', '')}
          counts={{ accessibleLessonCount: 4, completedLessonCount: 3 }}
        />
        <CourseCard
          course={course('finished', '')}
          counts={{ accessibleLessonCount: 4, completedLessonCount: 4 }}
        />
      </ThemeProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/my'] }),
  });
  await router.load();
  renderWithProviders(<RouterProvider router={router} />);
};

describe('CourseCard', () => {
  it('stacks the card as a column so the body can fill the shared row height', async () => {
    await renderCards();

    for (const id of ['with-description', 'without-description']) {
      const root = getComputedStyle(screen.getByTestId(`course-card-${id}`));
      expect(root.display).toBe('flex');
      expect(root.flexDirection).toBe('column');
      expect(getComputedStyle(screen.getByTestId(`course-card-body-${id}`)).flexGrow).toBe('1');
    }
  });

  it('pins the progress row to the bottom whether or not the course has a description', async () => {
    await renderCards();

    for (const id of ['with-description', 'without-description']) {
      expect(getComputedStyle(screen.getByTestId(`course-progress-row-${id}`)).marginTop).toBe(
        'auto',
      );
    }
  });

  it('marks a finished course next to its percentage and nowhere else', async () => {
    await renderCards();

    const finished = screen.getByTestId('course-progress-row-finished');
    expect(within(finished).getByTestId('course-progress-finished')).toHaveTextContent('100%');
    expect(within(finished).getByTestId('completion-mark')).toHaveAccessibleName(
      en.courseOverview.courseCompleted,
    );

    const partial = screen.getByTestId('course-progress-row-with-description');
    expect(within(partial).queryByTestId('completion-mark')).not.toBeInTheDocument();
  });

  it('lets the description absorb the leftover height above the progress row', async () => {
    await renderCards();

    const description = screen.getByText('A long enough summary to grow the card.');
    expect(getComputedStyle(description).flexGrow).toBe('1');
  });
});
