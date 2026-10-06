import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, Paper, Stack, Typography } from '@mui/material';
import { userEvent, within } from 'storybook/test';

import { LessonEditionBadge, LessonEditionBanner, LessonEditionMenu, LessonEditionsList } from '../features/member/LessonEditions.js';
import { en } from '../i18n/en.js';
import { useTranslations } from '../i18n/index.js';
import { withAccountPreview } from './page-decorators.js';

const editions = [
  { number: '10', note: 'Revised examples and updated references.', markedAt: '2026-10-01T12:00:00.000Z' },
  { number: '2.1', note: 'Additional practice material.', markedAt: '2026-09-01T12:00:00.000Z' },
  { number: '1', note: null, markedAt: '2026-08-01T12:00:00.000Z' },
];

const meta = {
  title: 'Member/LessonEditions',
  decorators: [withAccountPreview],
  parameters: { locale: 'en', colorScheme: 'light' },
  render: function EditionPreview() {
    const t = useTranslations();
    return (
      <Box data-testid="story-lesson-editions" sx={{ p: { xs: '1rem', sm: '2rem' }, maxWidth: '60rem', mx: 'auto' }}>
        <Stack spacing={3}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h1" sx={{ flexGrow: 1 }}>Chapter 3</Typography>
            <LessonEditionBadge number="2.1" />
            <LessonEditionMenu editions={editions} onSelect={() => undefined} />
          </Stack>
          <LessonEditionBanner onCurrent={() => undefined} />
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h2">{t.lesson.previousEditions}</Typography>
            <LessonEditionsList editions={editions} onSelect={() => undefined} />
          </Paper>
        </Stack>
      </Box>
    );
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const LightDesktop: Story = { globals: { viewport: { value: 'desktop' } } };
export const DarkDesktop: Story = { parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };
export const LightMobile: Story = { globals: { viewport: { value: 'mobile' } } };
export const DarkMobile: Story = { parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };
export const MenuLightDesktop: Story = {
  ...LightDesktop,
  play: async ({ canvasElement }) => {
    await document.fonts.ready;
    await userEvent.click(within(canvasElement).getByRole('button', { name: en.lesson.editionMenu }));
  },
};
export const MenuDarkDesktop: Story = { ...MenuLightDesktop, ...DarkDesktop };
export const MenuLightMobile: Story = { ...MenuLightDesktop, ...LightMobile };
export const MenuDarkMobile: Story = { ...MenuLightDesktop, ...DarkMobile };
