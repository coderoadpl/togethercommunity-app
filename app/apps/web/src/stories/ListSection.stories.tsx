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
  { email: 'alex.chen@example.com', course: 'JavaScript Basics', status: 'Active', joined: '2026-06-02' },
  { email: 'taylor.reed@example.com', course: 'Practical TypeScript', status: 'Active', joined: '2026-06-11' },
  { email: 'morgan.price@example.com', course: 'React for Creators', status: 'Expired', joined: '2026-05-20' },
];

const toolbar = {
  search: <OutlinedInput fullWidth size="small" placeholder="Search learner…" aria-label="Search learner" />,
  filters: (
    <Stack direction="row" useFlexGap spacing="0.4rem" role="group" aria-label="Status filter">
      <Chip size="small" label="All" variant="filled" color="primary" />
      <Chip size="small" label="Active" variant="outlined" />
      <Chip size="small" label="Expired" variant="outlined" />
    </Stack>
  ),
  actions: <Button variant="contained">+ Invite</Button>,
};

export const WithData: Story = {
  args: {
    title: 'Learners',
    toolbar,
    isEmpty: false,
    empty: null,
    children: (
      <ResponsiveTable>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>E-mail</TableCell>
              <TableCell>Course</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Joined</TableCell>
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
                    color={row.status === 'Active' ? 'success' : 'default'}
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
    title: 'Learners',
    toolbar,
    isEmpty: false,
    empty: null,
    noMatches: (
      <Typography variant="body1" color="text.secondary">
        No learners match the search.
      </Typography>
    ),
    children: null,
  },
};

export const CollectionEmpty: Story = {
  args: {
    title: 'Learners',
    isEmpty: true,
    empty: (
      <StatusView
        state={{
          kind: 'empty',
          title: 'You have no learners yet',
          body: 'Share a checkout link to sell the first access.',
        }}
      />
    ),
    children: null,
  },
};
