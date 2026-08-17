import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  updateProductAccessItemsInputSchema,
  type Course,
  type CourseLesson,
  type CourseModule,
  type Product,
} from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { ProductAccessEditor } from './ProductAccessEditor.js';

const product: Product = {
  id: 'product-1',
  tenantId: 't1',
  type: 'course',
  slug: 'bundle',
  title: 'Bundle',
  description: '',
  coverUrl: null,
  priceCents: 0,
  currency: 'PLN',
  published: false,
  accessItems: [],
  legacyId: null,
  createdAt: '2026-07-12T10:00:00.000Z',
};

const course: Course = {
  id: 'course-1',
  tenantId: 't1',
  name: 'Launch Kit',
  description: '',
  imageUrl: null,
  moduleOrder: [],
  publiclyVisible: false,
  legacyId: null,
  createdAt: '2026-07-12T10:00:00.000Z',
};

const courseModule: CourseModule = {
  id: 'module-1',
  tenantId: 't1',
  courseIds: ['course-1'],
  title: 'Module One',
  prefix: null,
  name: 'Module One',
  chapters: [
    {
      id: 'chapter-1',
      name: 'Chapter One',
      contents: [
        { id: 'content-1', name: 'Watch', lessonId: 'lesson-1' },
        { id: 'content-2', name: 'Practice', lessonId: 'lesson-2' },
        { id: 'content-3', name: 'Build', lessonId: 'lesson-3' },
        { id: 'content-4', name: 'Review', lessonId: 'lesson-4' },
      ],
    },
  ],
  legacyId: null,
  createdAt: '2026-07-12T10:00:00.000Z',
};

const lesson: CourseLesson = {
  id: 'lesson-1',
  tenantId: 't1',
  name: 'Intro lesson',
  isPreview: false,
  contents: [],
  legacyId: null,
  createdAt: '2026-07-12T10:00:00.000Z',
};

const lessons: CourseLesson[] = [
  lesson,
  { ...lesson, id: 'lesson-2', name: 'Advanced lesson' },
  { ...lesson, id: 'lesson-3', name: 'Workshop lesson' },
  { ...lesson, id: 'lesson-4', name: 'Summary lesson' },
];

const setup = (productFixture: Product = product): { bodies: unknown[] } => {
  const bodies: unknown[] = [];
  server.use(
    http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products: [productFixture] } })),
    http.get('/api/courses', () => HttpResponse.json({ ok: true, data: { courses: [course] } })),
    http.get('/api/modules', () => HttpResponse.json({ ok: true, data: { modules: [courseModule] } })),
    http.get('/api/lessons', () => HttpResponse.json({ ok: true, data: { lessons } })),
    http.post('/api/products/access-items', async ({ request }) => {
      const body = await request.json();
      bodies.push(body);
      const parsed = updateProductAccessItemsInputSchema.parse(body);
      return HttpResponse.json({
        ok: true,
        data: { product: { ...productFixture, accessItems: parsed.accessItems } },
      });
    }),
  );
  return { bodies };
};

describe('ProductAccessEditor', () => {
  it('Easy mode builds a course-level access payload in one click', async () => {
    const { bodies } = setup();
    renderWithProviders(<ProductAccessEditor product={product} />);

    await userEvent.click(await screen.findByRole('combobox', { name: pl.access.courseLabel }));
    await userEvent.click(await screen.findByRole('option', { name: 'Launch Kit' }));
    await userEvent.click(screen.getByRole('button', { name: pl.access.addFullCourse }));

    expect(await screen.findByText(pl.access.wholeCourseSummary({ course: 'Launch Kit' }))).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: pl.access.save }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      id: 'product-1',
      accessItems: [{ level: 'course', courseId: 'course-1' }],
    });
  });

  it('Pro mode builds a lesson-level access payload', async () => {
    const { bodies } = setup();
    renderWithProviders(<ProductAccessEditor product={product} />);

    await userEvent.click(await screen.findByLabelText(pl.access.proMode));
    await userEvent.click(await screen.findByRole('combobox', { name: pl.access.courseLabel }));
    await userEvent.click(await screen.findByRole('option', { name: 'Launch Kit' }));
    await userEvent.click(screen.getByRole('button', { name: pl.access.selectedLessons }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Intro lesson' }));
    await userEvent.click(screen.getByRole('button', { name: pl.access.addItem }));

    expect(
      await screen.findByText(pl.access.lessonsSummary({ lessons: 'Intro lesson' })),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: pl.access.save }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      id: 'product-1',
      accessItems: [{ level: 'lessons', courseId: 'course-1', lessonIds: ['lesson-1'] }],
    });
  });

  it('Pro mode builds a course-level access payload with excluded modules', async () => {
    const { bodies } = setup();
    renderWithProviders(<ProductAccessEditor product={product} />);

    await userEvent.click(await screen.findByLabelText(pl.access.proMode));
    await userEvent.click(await screen.findByRole('combobox', { name: pl.access.courseLabel }));
    await userEvent.click(await screen.findByRole('option', { name: 'Launch Kit' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Module One' }));
    await userEvent.click(screen.getByRole('button', { name: pl.access.addItem }));

    expect(
      await screen.findByText(
        pl.access.wholeCourseExceptSummary({ course: 'Launch Kit', modules: 'Module One' }),
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: pl.access.save }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      id: 'product-1',
      accessItems: [{ level: 'course', courseId: 'course-1', excludedModuleIds: ['module-1'] }],
    });
  });

  it('Groups access items by course and shows resolved lesson names', async () => {
    const productWithAccess: Product = {
      ...product,
      accessItems: [
        { level: 'course', courseId: 'course-1' },
        { level: 'lessons', courseId: 'course-1', lessonIds: ['lesson-1'] },
      ],
    };
    setup(productWithAccess);
    renderWithProviders(<ProductAccessEditor product={productWithAccess} />);

    expect(await screen.findAllByText('Launch Kit')).toHaveLength(1);
    expect(screen.getByText(pl.access.wholeCourseSummary({ course: 'Launch Kit' }))).toBeInTheDocument();
    expect(screen.getByText(pl.access.lessonsSummary({ lessons: 'Intro lesson' }))).toBeInTheDocument();
    expect(screen.getAllByTestId('access-item')).toHaveLength(2);
  });

  it('Truncates long lesson lists and exposes the full list in a tooltip', async () => {
    const productWithAccess: Product = {
      ...product,
      accessItems: [
        {
          level: 'lessons',
          courseId: 'course-1',
          lessonIds: ['lesson-1', 'lesson-2', 'lesson-3', 'lesson-4'],
        },
      ],
    };
    setup(productWithAccess);
    renderWithProviders(<ProductAccessEditor product={productWithAccess} />);

    const summary = await screen.findByText(
      pl.access.lessonsSummary({
        lessons: `Intro lesson, Advanced lesson, Workshop lesson, ${pl.access.andMore({ count: 1 })}`,
      }),
    );
    await userEvent.hover(summary);

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Intro lesson, Advanced lesson, Workshop lesson, Summary lesson',
    );
  });

  it('Edits an existing access item in place', async () => {
    const productWithAccess: Product = {
      ...product,
      accessItems: [{ level: 'lessons', courseId: 'course-1', lessonIds: ['lesson-1'] }],
    };
    const { bodies } = setup(productWithAccess);
    renderWithProviders(<ProductAccessEditor product={productWithAccess} />);

    await userEvent.click(await screen.findByRole('button', { name: pl.access.editItem }));
    expect(await screen.findByRole('checkbox', { name: 'Intro lesson' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Advanced lesson' }));
    await userEvent.click(screen.getByRole('button', { name: pl.access.updateItem }));
    await userEvent.click(screen.getByRole('button', { name: pl.access.save }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      id: 'product-1',
      accessItems: [
        { level: 'lessons', courseId: 'course-1', lessonIds: ['lesson-1', 'lesson-2'] },
      ],
    });
  });
});
