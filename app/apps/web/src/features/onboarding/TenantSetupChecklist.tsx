import { Alert, Button, Chip, List, ListItem, ListItemButton, ListItemText, Typography } from '@mui/material';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { tenantSetupProgress, type TenantSetupItem, type TenantSetupItemId, type TenantSetupTier } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations, type Messages } from '../../i18n/index.js';
import { ChecklistSection } from './ChecklistSection.js';

const itemCopy = (
  items: Messages['tenantSetup']['items'],
  id: TenantSetupItemId,
): { label: string; impact: string } => {
  switch (id) {
    case 'stripe':
      return items.stripe;
    case 'email_sending':
      return items.emailSending;
    case 'storage':
      return items.storage;
    case 'legal_terms':
      return items.legalTerms;
    case 'public_home':
      return items.publicHome;
    case 'billing_portal':
      return items.billingPortal;
    case 'video':
      return items.video;
    case 'branding':
      return items.branding;
    case 'invoicing':
      return items.invoicing;
  }
};

const SetupGroup = ({ heading, items }: { heading: string; items: TenantSetupItem[] }) => {
  const t = useTranslations();
  const navigate = useNavigate();

  if (items.length === 0) return null;

  return (
    <>
      <Typography variant="overline" component="h4">
        {heading}
      </Typography>
      <List disablePadding>
        {items.map((item) => {
          const copy = itemCopy(t.tenantSetup.items, item.id);
          return (
            <ListItem
              key={item.id}
              disableGutters
              disablePadding
              data-testid={`tenant-setup-item-${item.id}`}
            >
              <ListItemButton
                component="a"
                href={`${item.route}#${item.hash}`}
                onClick={(event) => {
                  event.preventDefault();
                  void navigate({ to: item.route, hash: item.hash });
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  flexDirection: { xs: 'column', sm: 'row' },
                }}
              >
                <ListItemText primary={copy.label} secondary={copy.impact} sx={{ flex: 1, minWidth: 0, m: 0 }} />
                <Chip
                  size="small"
                  color={item.configured ? 'success' : 'warning'}
                  variant="outlined"
                  label={item.configured ? t.tenantSetup.itemConfigured : t.tenantSetup.itemMissing}
                  sx={{ flexShrink: 0, alignSelf: 'flex-start', mt: { xs: '0.35rem', sm: '0.15rem' } }}
                />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>
    </>
  );
};

export const TenantSetupChecklist = () => {
  const t = useTranslations();
  const [expanded, setExpanded] = useState(false);
  const setup = useQuery(actions.tenantSetupReadiness);

  if (setup.isPending) return <StatusView state={{ kind: 'loading', label: t.common.loading }} />;
  if (setup.isError) {
    return (
      <StatusView
        state={{
          kind: 'error',
          message: localizeError(setup.error, t),
          retry: { label: t.common.retry, onRetry: () => void setup.refetch() },
        }}
      />
    );
  }

  const items = setup.data.setup.items;
  const progress = tenantSetupProgress(setup.data.setup);
  const itemsVisible = !progress.requiredComplete || expanded;
  const byTier = (tier: TenantSetupTier) => items.filter((item) => item.tier === tier);

  return (
    <ChecklistSection
      title={t.tenantSetup.title}
      description={t.tenantSetup.progress({ configured: progress.configured, total: progress.total })}
      data-testid="tenant-setup-checklist"
      headerActions={
        progress.requiredComplete ? (
          <Button
            variant="text"
            aria-expanded={itemsVisible}
            onClick={() => setExpanded((current) => !current)}
            data-testid="tenant-setup-toggle"
          >
            {itemsVisible ? t.tenantSetup.hideItems : t.tenantSetup.showItems}
          </Button>
        ) : undefined
      }
    >
      {progress.requiredComplete ? (
        <Alert severity="success" data-testid="tenant-setup-complete">
          {t.tenantSetup.allConfigured}
        </Alert>
      ) : null}
      {itemsVisible ? (
        <>
          <SetupGroup heading={t.tenantSetup.requiredHeading} items={byTier('required')} />
          <SetupGroup heading={t.tenantSetup.optionalHeading} items={byTier('optional')} />
        </>
      ) : null}
    </ChecklistSection>
  );
};
