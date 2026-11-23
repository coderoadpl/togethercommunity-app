import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, Stack, Typography } from '@mui/material';
import { userEvent, within } from 'storybook/test';

import { LessonEditionBanner, LessonEditionPicker } from '../features/member/LessonEditions.js';
import { withAccountPreview } from './page-decorators.js';

const editions = [
  { number: '10', note: 'Revised examples and updated references.', markedAt: '2026-10-01T12:00:00.000Z' },
  { number: '2.1', note: 'Additional practice material.', markedAt: '2026-09-01T12:00:00.000Z' },
  { number: '1', note: null, markedAt: '2026-08-01T12:00:00.000Z' },
];

interface EditionStoryArgs {
  currentEdition: string | null;
  viewing?: string | undefined;
}

const meta = {
  title: 'Member/LessonEditions',
  decorators: [withAccountPreview],
  parameters: { locale: 'en', colorScheme: 'light' },
  args: { currentEdition: '10', viewing: '2.1' },
  render: function EditionPreview({ currentEdition, viewing }) {
    const viewed = editions.find((edition) => edition.number === viewing);
    return (
      <Box data-testid="story-lesson-editions" sx={{ p: { xs: '1rem', sm: '2rem' }, maxWidth: '60rem', mx: 'auto' }}>
        <Stack spacing={3}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h1" sx={{ flexGrow: 1 }}>Chapter 3</Typography>
            <LessonEditionPicker editions={editions} currentEdition={currentEdition} viewing={viewing} onSelect={() => undefined} onCurrent={() => undefined} />
          </Stack>
          {viewed === undefined || viewed.number === currentEdition
            ? null
            : <LessonEditionBanner number={viewed.number} markedAt={viewed.markedAt} onCurrent={() => undefined} />}
        </Stack>
      </Box>
    );
  },
} satisfies Meta<EditionStoryArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

const openDialog: Story['play'] = async ({ canvasElement }) => {
  await document.fonts.ready;
  await userEvent.click(within(canvasElement).getByTestId('lesson-edition-badge'));
};

export const LightDesktop: Story = { globals: { viewport: { value: 'desktop' } } };
export const DarkDesktop: Story = { parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };
export const LightMobile: Story = { parameters: { locale: 'pl' }, globals: { viewport: { value: 'mobile' } } };
export const DarkMobile: Story = { parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };
export const MenuLightDesktop: Story = { ...LightDesktop, play: openDialog };
export const MenuDarkDesktop: Story = { ...DarkDesktop, args: { currentEdition: null, viewing: undefined }, play: openDialog };
export const MenuLightMobile: Story = { ...LightMobile, play: openDialog };
export const MenuDarkMobile: Story = { ...DarkMobile, args: { currentEdition: '10', viewing: undefined }, play: openDialog };
