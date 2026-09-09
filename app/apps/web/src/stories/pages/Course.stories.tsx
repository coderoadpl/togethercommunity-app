import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/course.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/Course', id: 'course', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'course--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'course--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
export const ShadcnMobile375: Story = { parameters: { __id: 'course--shadcn--mobile-375', viewport: { defaultViewport: 'mobile-375' } }, globals: { viewport: { value: 'mobile-375' } } };

const structureCall = fixture.calls['studentCourseStructure:["course-js"]'];
const coursesCall = fixture.calls['studentCourses:[]'];
const longFixture = {
  ...fixture,
  calls: {
    ...fixture.calls,
    'studentCourseStructure:["course-js"]': {
      ...structureCall,
      value: {
        structure: {
          ...structureCall.value.structure,
          modules: Array.from({ length: 8 }, (_, index) =>
            structureCall.value.structure.modules.map((module) => index === 0 ? module : {
              ...module,
              id: `${module.id}-${index}`,
              name: `${module.name} ${index + 1}`,
              chapters: module.chapters.map((chapter) => ({
                ...chapter,
                id: `${chapter.id}-${index}`,
                lessons: chapter.lessons.map((lesson) => ({
                  ...lesson,
                  contentId: `${lesson.contentId}-${index}`,
                  lessonId: `${lesson.lessonId}-${index}`,
                })),
              })),
            }),
          ).flat(),
        },
      },
    },
    'studentCourses:[]': {
      ...coursesCall,
      value: {
        ...coursesCall.value,
        courses: coursesCall.value.courses.map((course) => ({
          ...course,
          description: `${course.description} `.repeat(30),
        })),
      },
    },
  },
};

export const LongCurriculum: Story = {
  parameters: { __id: 'course-long-curriculum--shadcn--desktop', fixture: longFixture, viewport: { defaultViewport: 'desktop' } },
  globals: { viewport: { value: 'desktop' } },
};

export const LongCurriculumMobile: Story = {
  parameters: { __id: 'course-long-curriculum--shadcn--mobile', fixture: longFixture, viewport: { defaultViewport: 'mobile' } },
  globals: { viewport: { value: 'mobile' } },
};

const progressCall = fixture.calls['studentProgress:["course-js"]'];
const longLessonName = 'Practical exercises: functions, arguments, closures, scope, and debugging complex applications';
export const LongResumeLabel: Story = {
  parameters: {
    __id: 'course-long-resume-label--shadcn--mobile-375',
    fixture: {
      ...fixture,
      calls: {
        ...fixture.calls,
        'studentProgress:["course-js"]': {
          ...progressCall,
          value: { progress: { ...progressCall.value.progress, resume: {
            ...progressCall.value.progress.resume,
            target: { ...progressCall.value.progress.resume.target, name: longLessonName },
          } } },
        },
      },
    },
    viewport: { defaultViewport: 'mobile-375' },
  },
  globals: { viewport: { value: 'mobile-375' } },
};
