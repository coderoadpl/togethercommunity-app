import type { Meta, StoryObj } from '@storybook/react-vite';
import { Paper, Stack, Typography } from '@mui/material';
import { userEvent, within } from 'storybook/test';

import { LessonReadingContent } from '../features/member/LessonReadingContent.js';
import { en } from '../i18n/en.js';
import { withAccountPreview } from './page-decorators.js';

const longHtml = `<h2>Working with variables</h2>${Array.from({ length: 12 }, (_, index) => `
  <h3>Example ${String(index + 1)}</h3>
  <p>A variable gives a value a name. Choose a clear name that describes what the value represents. Read the example, compare the results, and use the discussion below to share your observations.</p>
`).join('')}<figure><pre>const total = price * quantity;</pre><figcaption>Calculate the total from the price and quantity.</figcaption></figure>`;

const meta = {
  title: 'Member/LessonReadingContent',
  decorators: [withAccountPreview],
  parameters: { locale: 'en', colorScheme: 'light' },
  args: { html: longHtml },
  render: ({ html }) => (
    <Stack data-testid="story-lesson-reading" spacing={3} sx={{ maxWidth: '64rem', mx: 'auto', p: { xs: '1rem', sm: '2rem' } }}>
      <Typography variant="h1">Working with variables</Typography>
      <Paper sx={{ p: { xs: '1rem', sm: '1.5rem' } }}>
        <LessonReadingContent html={html} />
      </Paper>
      <Typography variant="h2">{en.discussion.heading}</Typography>
    </Stack>
  ),
} satisfies Meta<{ html: string }>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CollapsedDesktop: Story = { globals: { viewport: { value: 'desktop' } } };
export const CollapsedMobile: Story = { globals: { viewport: { value: 'mobile' } } };
export const Expanded: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: en.lesson.showAll }));
  },
};
export const Short: Story = { args: { html: '<h2>One clear name</h2><p>Choose names that describe the value.</p><ul><li>Keep related values together.</li></ul>' } };
