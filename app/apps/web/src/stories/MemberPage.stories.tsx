import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Badge,
  BottomNavigation,
  BottomNavigationAction,
  Button,
  LinearProgress,
  Link,
  Paper,
  Stack,
  SvgIcon,
  Typography,
} from '@mui/material';

import { MemberPage } from '../components/layout/MemberPage.js';
import { SectionCard } from '../components/layout/SectionCard.js';

const meta = {
  title: 'Layout/MemberPage',
  component: MemberPage,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof MemberPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const Glyph = ({ d }: { d: string }) => (
  <SvgIcon fontSize="small" aria-hidden viewBox="0 0 24 24">
    <path d={d} />
  </SvgIcon>
);

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

export const WithBottomTabBar: Story = {
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
    bottomNav: (
      <BottomNavigation showLabels value={0}>
        <BottomNavigationAction
          label="Kursy"
          icon={<Glyph d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z" />}
        />
        <BottomNavigationAction
          label="Produkty"
          icon={<Glyph d="M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />}
        />
        <BottomNavigationAction
          label="Powiadomienia"
          icon={
            <Badge badgeContent={2} color="secondary">
              <Glyph d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2z" />
            </Badge>
          }
        />
        <BottomNavigationAction
          label="Konto"
          icon={<Glyph d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6z" />}
        />
      </BottomNavigation>
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
