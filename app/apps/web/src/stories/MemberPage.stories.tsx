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
      Zmienne przechowują wartości, które program może odczytywać i zmieniać w czasie działania.
      W tej lekcji poznasz różnice między <code>let</code>, <code>const</code> i <code>var</code>.
    </Typography>
    <Typography variant="body1">
      Deklaracja <code>const</code> tworzy wiązanie, którego nie można przypisać ponownie — to
      domyślny wybór, dopóki nie potrzebujesz zmienności.
    </Typography>
  </Stack>
);

const progressRail: ReactNode = (
  <SectionCard title="Twój postęp">
    <Typography variant="body2" color="text.secondary">
      Ukończono 3 z 8 lekcji
    </Typography>
    <LinearProgress variant="determinate" value={37} sx={{ mt: '0.75rem' }} />
    <Button variant="outlined" fullWidth sx={{ mt: '1rem' }}>
      Przejdź do następnej lekcji
    </Button>
  </SectionCard>
);

export const LessonWithRail: Story = {
  args: {
    eyebrow: 'JavaScript od zera · Moduł 1',
    title: 'Zmienne i typy',
    breadcrumbLabel: 'Okruszki',
    width: 'prose',
    breadcrumbs: [
      { label: 'Moje kursy', link: <Link href="#">Moje kursy</Link> },
      { label: 'JavaScript od zera', link: <Link href="#">JavaScript od zera</Link> },
      { label: 'Zmienne i typy' },
    ],
    rail: progressRail,
    mobileRail: 'after',
    children: lessonBody,
  },
};

export const WideLibrary: Story = {
  args: {
    eyebrow: 'Twoja biblioteka',
    title: 'Moje kursy',
    breadcrumbLabel: 'Okruszki',
    width: 'wide',
    children: (
      <Stack useFlexGap spacing="1rem">
        {['JavaScript od zera', 'TypeScript w praktyce', 'React dla twórców'].map((course) => (
          <Paper key={course} elevation={1} sx={{ p: '1.25rem' }}>
            <Typography variant="h2" component="h3">
              {course}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: '0.35rem' }}>
              Kontynuuj naukę tam, gdzie skończyłeś.
            </Typography>
          </Paper>
        ))}
      </Stack>
    ),
  },
};

export const LoadingState: Story = {
  args: {
    eyebrow: 'JavaScript od zera',
    title: 'Zmienne i typy',
    breadcrumbLabel: 'Okruszki',
    state: { kind: 'loading', label: 'Wczytywanie lekcji…' },
  },
};
