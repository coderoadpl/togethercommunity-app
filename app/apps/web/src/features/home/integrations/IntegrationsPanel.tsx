import { Stack, Tab, Tabs } from '@mui/material';
import { useNavigate, useRouterState } from '@tanstack/react-router';

import type { SyntheticEvent } from 'react';

import { PanelPage } from '../../../components/layout/index.js';
import { useTranslations } from '../../../i18n/index.js';
import { ApiKeysTab } from './ApiKeysTab.js';
import { EmailTab } from './EmailTab.js';
import { InvoicingTab } from './InvoicingTab.js';
import { StorageTab } from './StorageTab.js';
import { StripeTab } from './StripeTab.js';
import { VideoTab } from './VideoTab.js';

type IntegrationsSection = 'stripe' | 'email' | 'storage' | 'video' | 'invoicing' | 'api-keys';

const integrationsSectionFromHash = (hash: string): IntegrationsSection => {
  switch (hash.replace(/^#/, '')) {
    case 'email':
    case 'sending':
    case 'ses':
    case 'smtp':
    case 'resend':
      return 'email';
    case 'storage':
    case 's3':
      return 'storage';
    case 'video':
    case 'bunny':
      return 'video';
    case 'invoicing':
    case 'ifirma':
    case 'ksef':
      return 'invoicing';
    case 'api-keys':
      return 'api-keys';
    case 'stripe':
    case 'payments':
    default:
      return 'stripe';
  }
};

export const IntegrationsPanel = () => {
  const t = useTranslations();
  const navigate = useNavigate();
  const hash = useRouterState({ select: (state) => state.location.hash });
  const section = integrationsSectionFromHash(hash);

  const changeSection = (_event: SyntheticEvent, value: IntegrationsSection) => {
    void navigate({ hash: value, replace: true });
  };

  return (
    <PanelPage title={t.integrations.heading} description={t.integrations.intro}>
      <Tabs
        value={section}
        onChange={changeSection}
        aria-label={t.integrations.tabsAria}
        variant="scrollable"
        allowScrollButtonsMobile
      >
        <Tab id="integrations-tab-stripe" aria-controls="integrations-panel-stripe" value="stripe" label={t.integrations.tabStripe} />
        <Tab id="integrations-tab-email" aria-controls="integrations-panel-email" value="email" label={t.integrations.tabEmail} />
        <Tab id="integrations-tab-storage" aria-controls="integrations-panel-storage" value="storage" label={t.integrations.tabStorage} />
        <Tab id="integrations-tab-video" aria-controls="integrations-panel-video" value="video" label={t.integrations.tabVideo} />
        <Tab id="integrations-tab-invoicing" aria-controls="integrations-panel-invoicing" value="invoicing" label={t.integrations.tabInvoicing} />
        <Tab id="integrations-tab-api-keys" aria-controls="integrations-panel-api-keys" value="api-keys" label={t.integrations.tabApiKeys} />
      </Tabs>

      {section === 'stripe' ? (
        <Stack id="integrations-panel-stripe" role="tabpanel" aria-labelledby="integrations-tab-stripe" useFlexGap spacing="1.5rem">
          <StripeTab />
        </Stack>
      ) : null}
      {section === 'email' ? (
        <Stack id="integrations-panel-email" role="tabpanel" aria-labelledby="integrations-tab-email" useFlexGap spacing="1.5rem">
          <EmailTab />
        </Stack>
      ) : null}
      {section === 'storage' ? (
        <Stack id="integrations-panel-storage" role="tabpanel" aria-labelledby="integrations-tab-storage" useFlexGap spacing="1.5rem">
          <StorageTab />
        </Stack>
      ) : null}
      {section === 'video' ? (
        <Stack id="integrations-panel-video" role="tabpanel" aria-labelledby="integrations-tab-video" useFlexGap spacing="1.5rem">
          <VideoTab />
        </Stack>
      ) : null}
      {section === 'invoicing' ? (
        <Stack id="integrations-panel-invoicing" role="tabpanel" aria-labelledby="integrations-tab-invoicing" useFlexGap spacing="1.5rem">
          <InvoicingTab />
        </Stack>
      ) : null}
      {section === 'api-keys' ? (
        <Stack id="integrations-panel-api-keys" role="tabpanel" aria-labelledby="integrations-tab-api-keys" useFlexGap spacing="1.5rem">
          <ApiKeysTab />
        </Stack>
      ) : null}
    </PanelPage>
  );
};
