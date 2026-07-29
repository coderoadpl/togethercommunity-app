import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Box,
  Button,
  Chip,
  OutlinedInput,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

import { ListSection, ResponsiveTable } from '../components/layout/ListSection.js';
import { StatusView } from '../components/layout/StatusView.js';

const meta = {
  title: 'Layout/ListSection',
  component: ListSection,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <Box sx={{ p: '1.5rem', maxWidth: '60rem', mx: 'auto' }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof ListSection>;

export default meta;
type Story = StoryObj<typeof meta>;

const rows = [
  { email: 'anna.kowalska@example.com', course: 'JavaScript od zera', status: 'Aktywny', joined: '2026-06-02' },
  { email: 'piotr.nowak@example.com', course: 'TypeScript w praktyce', status: 'Aktywny', joined: '2026-06-11' },
  { email: 'maria.wisniewska@example.com', course: 'React dla twórców', status: 'Wygasł', joined: '2026-05-20' },
];

const toolbar = {
  search: <OutlinedInput fullWidth size="small" placeholder="Szukaj kursanta…" aria-label="Szukaj kursanta" />,
  filters: (
    <Stack direction="row" useFlexGap spacing="0.4rem" role="group" aria-label="Filtr statusu">
      <Chip size="small" label="Wszyscy" variant="filled" color="primary" />
      <Chip size="small" label="Aktywni" variant="outlined" />
      <Chip size="small" label="Wygaśli" variant="outlined" />
    </Stack>
  ),
  actions: <Button variant="contained">+ Zaproś</Button>,
};

export const WithData: Story = {
  args: {
    title: 'Kursanci',
    toolbar,
    isEmpty: false,
    empty: null,
    children: (
      <ResponsiveTable>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>E-mail</TableCell>
              <TableCell>Kurs</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Dołączył</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.email}>
                <TableCell>{row.email}</TableCell>
                <TableCell>{row.course}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={row.status}
                    color={row.status === 'Aktywny' ? 'success' : 'default'}
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>{row.joined}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ResponsiveTable>
    ),
  },
};

export const NoMatches: Story = {
  args: {
    title: 'Kursanci',
    toolbar,
    isEmpty: false,
    empty: null,
    noMatches: (
      <Typography variant="body1" color="text.secondary">
        Brak kursantów pasujących do wyszukiwania.
      </Typography>
    ),
    children: null,
  },
};

export const CollectionEmpty: Story = {
  args: {
    title: 'Kursanci',
    isEmpty: true,
    empty: (
      <StatusView
        state={{
          kind: 'empty',
          title: 'Nie masz jeszcze kursantów',
          body: 'Udostępnij link do kasy, aby sprzedać pierwszy dostęp.',
        }}
      />
    ),
    children: null,
  },
};
