import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, LinearProgress, Link, Paper, Stack, Typography } from '@mui/material';

import { MemberPage } from '../components/layout/MemberPage.js';
import { SectionCard } from '../components/layout/SectionCard.js';

const meta = {
  title: 'Layout/MemberPage',
  component: MemberPage,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof MemberPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const lessonBody: ReactNode = (
  <Stack useFlexGap spacing="1.25rem">
    <Typography variant="body1">
      Variables store values that a program can read and update while it is running.
      In this lesson you will compare <code>let</code>, <code>const</code>, and <code>var</code>.
    </Typography>
    <Typography variant="body1">
      A <code>const</code> declaration creates a binding that cannot be reassigned — it is the
      default choice until you need mutability.
    </Typography>
  </Stack>
);

const progressRail: ReactNode = (
  <SectionCard title="Your progress">
    <Typography variant="body2" color="text.secondary">
      Completed 3 of 8 lessons
    </Typography>
    <LinearProgress variant="determinate" value={37} sx={{ mt: '0.75rem' }} />
    <Button variant="outlined" fullWidth sx={{ mt: '1rem' }}>
      Go to the next lesson
    </Button>
  </SectionCard>
);

export const LessonWithRail: Story = {
  args: {
    eyebrow: 'JavaScript Basics · Module 1',
    title: 'Variables and types',
    breadcrumbLabel: 'Breadcrumbs',
    width: 'prose',
    breadcrumbs: [
      { label: 'My courses', link: <Link href="#">My courses</Link> },
      { label: 'JavaScript Basics', link: <Link href="#">JavaScript Basics</Link> },
      { label: 'Variables and types' },
    ],
    rail: progressRail,
    mobileRail: 'after',
    children: lessonBody,
  },
};

export const WideLibrary: Story = {
  args: {
    eyebrow: 'Your library',
    title: 'My courses',
    breadcrumbLabel: 'Breadcrumbs',
    width: 'wide',
    children: (
      <Stack useFlexGap spacing="1rem">
        {['JavaScript Basics', 'Practical TypeScript', 'React for Creators'].map((course) => (
          <Paper key={course} elevation={1} sx={{ p: '1.25rem' }}>
            <Typography variant="h2" component="h3">
              {course}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: '0.35rem' }}>
              Continue learning where you left off.
            </Typography>
          </Paper>
        ))}
      </Stack>
    ),
  },
};

export const LoadingState: Story = {
  args: {
    eyebrow: 'JavaScript Basics',
    title: 'Variables and types',
    breadcrumbLabel: 'Breadcrumbs',
    state: { kind: 'loading', label: 'Loading lesson…' },
  },
};
