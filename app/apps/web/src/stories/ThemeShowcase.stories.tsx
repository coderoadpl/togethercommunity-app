import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, Chip, Stack, Typography } from '@mui/material';

import { SectionCard } from '../components/layout/SectionCard.js';
import { DataValue } from '../theme.js';

const meta = {
  title: 'Layout/Theme showcase',
  component: SectionCard,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof SectionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const showcase: ReactNode = (
  <Stack useFlexGap spacing="0.75rem">
    <Typography variant="body1">
      Sales this month: <DataValue>$4,210.00</DataValue>
    </Typography>
    <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ flexWrap: 'wrap' }}>
      <Chip label="Published" color="success" variant="outlined" />
      <Chip label="Draft" variant="outlined" />
      <Chip label="Expired" color="warning" variant="outlined" />
    </Stack>
    <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ flexWrap: 'wrap' }}>
      <Button variant="contained">Primary action</Button>
      <Button variant="outlined">Secondary action</Button>
      <Button variant="text">Text action</Button>
    </Stack>
  </Stack>
);

const baseArgs = {
  title: 'Creator panel',
  description: 'The same component rendered in each of the seven themes.',
  children: showcase,
};

export const Logbook: Story = { args: baseArgs, globals: { theme: 'logbook' } };
export const Material: Story = { args: baseArgs, globals: { theme: 'material' } };
export const QuietStudio: Story = { args: baseArgs, globals: { theme: 'quiet-studio' } };
export const Scoreboard: Story = { args: baseArgs, globals: { theme: 'scoreboard' } };
export const Shadcn: Story = { args: baseArgs, globals: { theme: 'shadcn' } };
export const SignalMono: Story = { args: baseArgs, globals: { theme: 'signal-mono' } };
export const SteadyFrame: Story = { args: baseArgs, globals: { theme: 'steady-frame' } };
