import type { Meta, StoryObj } from '@storybook/react-vite';
import recordedFixture from '../fixtures/anon-course.json';
import type { CourseStructureWithAccess } from '#core/domain/index.js';
import { withPage } from '../page-decorators.js';

const recordedStructure = recordedFixture.calls['publicCourseStructure:["course-js"]'].value.structure;
const catalogEntry = recordedFixture.calls['publicNavigation:[]'].value.navigation.courses[0];
const offer = {
  description: catalogEntry?.description ?? '', imageUrl: catalogEntry?.imageUrl ?? null,
  salesUrl: null, supportUrl: 'https://courses.example.org/contact',
  product: { id: 'product-club', priceCents: 4900, currency: 'PLN', interval: 'month' },
} satisfies NonNullable<CourseStructureWithAccess['offer']>;
const guestFixture = (variant: 'product' | 'sales' | 'login') => ({
  ...recordedFixture,
  calls: {
    ...recordedFixture.calls,
    'publicCourseStructure:["course-js"]': { ok: true, value: { structure: {
      ...recordedStructure,
      offer: { ...offer, product: variant === 'product' ? offer.product : null,
        salesUrl: variant === 'sales' ? 'https://courses.example.org/offer' : null },
      modules: recordedStructure.modules.map((module, moduleIndex) => ({
        ...module,
        accessStatus: moduleIndex === 0 ? 'partially-accessible' : 'not-accessible',
        chapters: module.chapters.map((chapter, chapterIndex) => ({ ...chapter,
          accessStatus: moduleIndex === 0 && chapterIndex === 0 ? 'fully-accessible' : 'not-accessible',
          lessons: chapter.lessons.map((lesson, lessonIndex) => {
            const isPreview = moduleIndex === 0 && chapterIndex === 0 && lessonIndex === 0;
            return { ...lesson, isPreview, accessStatus: isPreview ? 'fully-accessible' : 'not-accessible' };
          }),
        })),
      })),
    } } },
  },
});
const fixture = guestFixture('product');

const meta = { title: 'Pages/AnonCourse', id: 'anon-course', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'anon-course--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'anon-course--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };

const guestStory = (variant: 'product' | 'sales' | 'login', viewport: 'desktop' | 'mobile', locale: 'pl' | 'en', colorScheme: 'light' | 'dark'): Story => ({
  parameters: { fixture: guestFixture(variant), locale, colorScheme, viewport: { defaultViewport: viewport } },
  globals: { viewport: { value: viewport } },
});
export const WithProductDesktopPlLight: Story = guestStory('product', 'desktop', 'pl', 'light');
export const WithProductDesktopPlDark: Story = guestStory('product', 'desktop', 'pl', 'dark');
export const WithProductDesktopEnLight: Story = guestStory('product', 'desktop', 'en', 'light');
export const WithProductDesktopEnDark: Story = guestStory('product', 'desktop', 'en', 'dark');
export const WithProductMobilePlLight: Story = guestStory('product', 'mobile', 'pl', 'light');
export const WithProductMobilePlDark: Story = guestStory('product', 'mobile', 'pl', 'dark');
export const WithProductMobileEnLight: Story = guestStory('product', 'mobile', 'en', 'light');
export const WithProductMobileEnDark: Story = guestStory('product', 'mobile', 'en', 'dark');
export const WithSalesUrlDesktopPlLight: Story = guestStory('sales', 'desktop', 'pl', 'light');
export const WithSalesUrlDesktopPlDark: Story = guestStory('sales', 'desktop', 'pl', 'dark');
export const WithSalesUrlDesktopEnLight: Story = guestStory('sales', 'desktop', 'en', 'light');
export const WithSalesUrlDesktopEnDark: Story = guestStory('sales', 'desktop', 'en', 'dark');
export const WithSalesUrlMobilePlLight: Story = guestStory('sales', 'mobile', 'pl', 'light');
export const WithSalesUrlMobilePlDark: Story = guestStory('sales', 'mobile', 'pl', 'dark');
export const WithSalesUrlMobileEnLight: Story = guestStory('sales', 'mobile', 'en', 'light');
export const WithSalesUrlMobileEnDark: Story = guestStory('sales', 'mobile', 'en', 'dark');
export const WithoutOfferDesktopPlLight: Story = guestStory('login', 'desktop', 'pl', 'light');
export const WithoutOfferDesktopPlDark: Story = guestStory('login', 'desktop', 'pl', 'dark');
export const WithoutOfferDesktopEnLight: Story = guestStory('login', 'desktop', 'en', 'light');
export const WithoutOfferDesktopEnDark: Story = guestStory('login', 'desktop', 'en', 'dark');
export const WithoutOfferMobilePlLight: Story = guestStory('login', 'mobile', 'pl', 'light');
export const WithoutOfferMobilePlDark: Story = guestStory('login', 'mobile', 'pl', 'dark');
export const WithoutOfferMobileEnLight: Story = guestStory('login', 'mobile', 'en', 'light');
export const WithoutOfferMobileEnDark: Story = guestStory('login', 'mobile', 'en', 'dark');
