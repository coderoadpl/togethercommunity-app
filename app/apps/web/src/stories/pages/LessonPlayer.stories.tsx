import { fireEvent, within } from 'storybook/test';
import { en } from '../../i18n/en.js';
import { pl } from '../../i18n/pl.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import acmeFixture from '../fixtures/acme-lesson.json';
import fixture from '../fixtures/lesson.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/LessonPlayer', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const LightDesktop: Story = { parameters: { viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const LightMobile: Story = { parameters: { viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
export const Acme: Story = {
  parameters: {
    fixture: {
      ...acmeFixture,
      calls: {
        ...acmeFixture.calls,
        'studentLessonPlayback:["lesson-acme-intro"]': {
          ok: true,
          value: {
            lessonId: 'lesson-acme-intro',
            expiresAt: '2026-09-08T12:00:00.000Z',
            videos: [{
              kind: 'bunny',
              storageKey: '197133/dc48a09e-d9bb-420a-83d7-72dc2304c034',
              videoId: 'dc48a09e-d9bb-420a-83d7-72dc2304c034',
              libraryId: '197133',
              embedUrl: 'https://iframe.mediadelivery.net/embed/197133/dc48a09e-d9bb-420a-83d7-72dc2304c034',
              hlsUrl: null,
              signed: false,
            }],
          },
        },
      },
    },
  },
};

const unavailableFixture = (reason: 'missing_library_id' | 'secret_invalid') => ({
  ...fixture,
  calls: {
    ...fixture.calls,
    'studentLesson:["lesson-js-variables-1"]': {
      ok: true,
      value: {
        ...fixture.calls['studentLesson:["lesson-js-variables-1"]'].value,
        lesson: {
          ...fixture.calls['studentLesson:["lesson-js-variables-1"]'].value.lesson,
          contents: [{ type: 'video', storageKey: 'video-1', streamVideoId: 'video-1' }],
        },
      },
    },
    'studentLessonPlayback:["lesson-js-variables-1"]': {
      ok: true,
      value: {
        lessonId: 'lesson-js-variables-1',
        expiresAt: '2026-09-08T12:00:00.000Z',
        videos: [{ kind: 'unavailable', storageKey: 'video-1', reason }],
      },
    },
  },
});

export const MediaError: Story = {
  play: async ({ canvasElement, parameters }) => {
    const canvas = within(canvasElement);
    const iframe = await canvas.findByTestId('lesson-embed');
    await fireEvent.error(iframe);
    await canvas.findByText(parameters['locale'] === 'en' ? en.lesson.videoFailedTitle : pl.lesson.videoFailedTitle);
  },
};
export const MediaErrorEnglishDark: Story = { ...MediaError, parameters: { locale: 'en', colorScheme: 'dark' } };
export const MediaErrorMobile: Story = { ...MediaError, globals: { viewport: { value: 'mobile' } } };
export const MissingLibrary: Story = { parameters: { fixture: unavailableFixture('missing_library_id') } };
export const InvalidSecret: Story = { parameters: { fixture: unavailableFixture('secret_invalid') } };
export const MissingLibraryEnglishDark: Story = { parameters: { fixture: unavailableFixture('missing_library_id'), locale: 'en', colorScheme: 'dark' } };
export const InvalidSecretMobile: Story = { parameters: { fixture: unavailableFixture('secret_invalid') }, globals: { viewport: { value: 'mobile' } } };
