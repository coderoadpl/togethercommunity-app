import { Alert, Chip, List, ListItem, ListItemText, Stack, Typography } from '@mui/material';

import { SectionCard } from '../../../components/layout/index.js';

export interface MarketingReadinessItem {
  label: string;
  ready: boolean;
  caption?: string;
}

export const MarketingReadiness = ({
  title,
  items,
  readyLabel,
  blockedLabel,
  enabled,
  enabledMessage,
  disabledMessage,
}: {
  title: string;
  items: MarketingReadinessItem[];
  readyLabel: string;
  blockedLabel: string;
  enabled: boolean;
  enabledMessage: string;
  disabledMessage: string;
}) => (
  <SectionCard title={title} data-testid="marketing-readiness">
    <List disablePadding>
      {items.map((item) => (
        <ListItem key={item.label} disableGutters>
          <ListItemText primary={item.label} secondary={item.caption} />
          <Chip
            size="small"
            color={item.ready ? 'success' : 'warning'}
            variant="outlined"
            label={item.ready ? readyLabel : blockedLabel}
          />
        </ListItem>
      ))}
    </List>
    <Alert severity={enabled ? 'success' : 'warning'}>
      <Stack spacing="0.2rem">
        <Typography variant="body2">{enabled ? enabledMessage : disabledMessage}</Typography>
      </Stack>
    </Alert>
  </SectionCard>
);
