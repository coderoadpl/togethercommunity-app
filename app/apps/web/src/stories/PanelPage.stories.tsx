import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, Button, Stack } from '@mui/material';

import { PanelPage } from '../components/layout/PanelPage.js';
import { SectionCard } from '../components/layout/SectionCard.js';

const meta = {
  title: 'Layout/PanelPage',
  component: PanelPage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <Box sx={{ p: '1.5rem' }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof PanelPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithAction: Story = {
  args: {
    title: 'Produkty',
    description: 'Zarządzaj ofertą i linkami do kasy dla swoich kursów.',
    action: (
      <Button variant="contained">+ Dodaj</Button>
    ),
    children: (
      <Stack useFlexGap spacing="1.5rem">
        <SectionCard title="Kurs Together 101" description="Opublikowany · 12 sprzedaży">
          <Box>Pakiet startowy z dostępem do wszystkich lekcji modułu pierwszego.</Box>
        </SectionCard>
        <SectionCard title="Pakiet zaawansowany" description="Szkic · 0 sprzedaży">
          <Box>Dodatkowe materiały i sesje mentoringowe dla zaawansowanych.</Box>
        </SectionCard>
      </Stack>
    ),
  },
};

export const WithBackLink: Story = {
  args: {
    title: 'Nowy produkt',
    backTo: <a href="#">← Wróć do produktów</a>,
    children: (
      <SectionCard
        title="Podstawowe informacje"
        actions={<Button variant="contained">Zapisz</Button>}
      >
        <Box>Formularz tworzenia produktu.</Box>
      </SectionCard>
    ),
  },
};

export const EmptyState: Story = {
  args: {
    title: 'Sprzedaż',
    description: 'Historia transakcji Twojej szkoły.',
    state: {
      kind: 'empty',
      title: 'Brak sprzedaży',
      body: 'Gdy ktoś kupi Twój kurs, transakcja pojawi się tutaj.',
    },
  },
};
