import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, Button, Chip, OutlinedInput, Paper, Stack, Typography } from '@mui/material';

import { ListSection } from '../components/layout/ListSection.js';
import { PanelPage } from '../components/layout/PanelPage.js';
import { DataValue, EntryDate, PublishedStatus } from '../theme.js';

const meta = {
  title: 'Composites/Panel list page',
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

const products = [
  { title: 'Together Course 101', published: true, access: 3, created: 'June 2, 2026', sales: 12 },
  { title: 'Advanced package', published: false, access: 5, created: 'June 18, 2026', sales: 0 },
  { title: 'Mentoring 1:1', published: true, access: 1, created: 'June 30, 2026', sales: 4 },
];

export const Products: Story = {
  name: 'Product list',
  args: {
    title: 'Products',
    action: <Button variant="contained">+ Add</Button>,
    children: (
      <ListSection
        toolbar={{
          search: (
            <OutlinedInput fullWidth size="small" placeholder="Search product…" aria-label="Search product" />
          ),
          filters: (
            <Stack direction="row" useFlexGap spacing="0.4rem" role="group" aria-label="Status filter">
              <Chip size="small" label="All" variant="filled" color="primary" />
              <Chip size="small" label="Published" variant="outlined" />
              <Chip size="small" label="Drafts" variant="outlined" />
            </Stack>
          ),
        }}
        isEmpty={false}
        empty={null}
      >
        <Stack useFlexGap spacing="1rem">
          {products.map((product) => (
            <Paper key={product.title} elevation={1} sx={{ p: '1rem', display: 'grid', gap: '0.75rem' }}>
              <Stack direction="row" useFlexGap spacing="1rem" sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                <Typography variant="h2" component="h3">
                  {product.title}
                </Typography>
                {product.published ? null : (
                  <Chip size="small" color="warning" variant="outlined" label="Draft" />
                )}
                <Box sx={{ flex: 1 }} />
                {product.published ? null : <Button variant="text">Publish</Button>}
              </Stack>
              <Stack useFlexGap spacing="0.2rem">
                <span>
                  {product.published ? <PublishedStatus>Published</PublishedStatus> : 'Draft'} ·{' '}
                  <DataValue>{product.access}</DataValue> access items · <DataValue>{product.sales}</DataValue>{' '}
                  sales
                </span>
                <EntryDate component="span">{product.created}</EntryDate>
              </Stack>
              <Box>
                <Button size="small" variant="text">
                  Manage
                </Button>
              </Box>
            </Paper>
          ))}
        </Stack>
      </ListSection>
    ),
  },
};
