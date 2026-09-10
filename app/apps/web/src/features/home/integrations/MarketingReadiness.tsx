import { Alert, Chip, List, ListItem, ListItemText, Stack, Typography } from '@mui/material';

import { SectionCard } from '../../../components/layout/index.js';

export interface MarketingReadinessItem {
  label: string;
  ready: boolean;
  caption?: string;
  required?: boolean;
  blockedLabel?: string;
}

export const MarketingReadiness = ({
  title,
  items,
  readyLabel,
  blockedLabel,
  optionalLabel,
  attentionItemsMessage,
  readyMessage,
}: {
  title: string;
  items: MarketingReadinessItem[];
  readyLabel: string;
  blockedLabel: string;
  optionalLabel: string;
  attentionItemsMessage: (input: { items: string }) => string;
  readyMessage: string;
}) => {
  const blocking = items.filter((item) => (item.required ?? true) && !item.ready);
  return (
    <SectionCard title={title} data-testid="marketing-readiness">
      <List disablePadding>
        {items.map((item) => (
          <ListItem key={item.label} disableGutters>
            <ListItemText primary={item.label} secondary={item.caption} />
            <Chip
              size="small"
              color={item.ready ? 'success' : item.required === false ? undefined : 'warning'}
              variant="outlined"
              label={item.ready ? readyLabel : item.required === false ? optionalLabel : item.blockedLabel ?? blockedLabel}
            />
          </ListItem>
        ))}
      </List>
      <Alert severity={blocking.length > 0 ? 'warning' : 'success'}>
        <Stack spacing="0.2rem">
          <Typography variant="body2">
            {blocking.length > 0
              ? attentionItemsMessage({ items: blocking.map((item) => item.label).join(', ') })
              : readyMessage}
          </Typography>
        </Stack>
      </Alert>
    </SectionCard>
  );
};
