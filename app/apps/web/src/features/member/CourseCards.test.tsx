import { ThemeProvider } from '@mui/material/styles';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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

  it('lets the description absorb the leftover height above the progress row', async () => {
    await renderCards();

    const description = screen.getByText('A long enough summary to grow the card.');
    expect(getComputedStyle(description).flexGrow).toBe('1');
  });
});
