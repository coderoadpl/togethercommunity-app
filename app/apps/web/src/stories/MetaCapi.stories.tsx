import { useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SectionCard } from '../components/layout/index.js';
import { SecretField } from '../components/ui/SecretField.js';
import { MetaCapiConsentDialog } from '../features/checkout/MetaCapiConsentDialog.js';
import { MetaCapiConsent } from '../features/checkout/MetaCapiConsent.js';
import { MetaCapiSettingsFields, type MetaCapiDraft } from '../features/home/settings/MetaCapiSettingsFields.js';
import { useTranslations } from '../i18n/index.js';
import { metaCapiConfig } from '../test/meta-capi-fixtures.js';
import { withSurveyPreview } from './page-decorators.js';

const ConsentPreview = ({ expanded = false, decided = false }: { expanded?: boolean; decided?: boolean }) => {
  const t = useTranslations();
  const [open, setOpen] = useState(!decided);
  return <Box data-testid="meta-capi-preview" sx={{ maxWidth: '40rem', mx: 'auto', py: 4 }}>
    <SectionCard title={t.checkout.successTitle}>
      <Typography>{t.checkout.successBody}</Typography>
      {decided ? <MetaCapiConsent config={{ ...metaCapiConfig, consent: 'granted' }} sessionId="cs_live_story" /> : null}
    </SectionCard>
    <MetaCapiConsentDialog config={metaCapiConfig} open={open} initiallyExpanded={expanded} onDismiss={() => setOpen(false)} onDecision={() => setOpen(false)} />
  </Box>;
};
const SettingsPreview = () => {
  const t = useTranslations();
  const [value, setValue] = useState<MetaCapiDraft>({
    analyticsMetaCapiEnabled: true,
    analyticsMetaCapiTestEventCode: 'TEST123',
    analyticsMetaCapiConsentHeading: metaCapiConfig.heading,
    analyticsMetaCapiConsentBody: metaCapiConfig.body,
    analyticsMetaCapiConsentAcceptLabel: metaCapiConfig.acceptLabel,
    analyticsMetaCapiConsentDeclineLabel: metaCapiConfig.declineLabel,
  });
  const [token, setToken] = useState('');
  const [configured, setConfigured] = useState(false);
  return <Stack data-testid="meta-capi-settings-preview" spacing={3} sx={{ maxWidth: '46rem', mx: 'auto' }}>
    <SectionCard title={t.analyticsSettings.heading} actions={<Button variant="contained">{t.common.save}</Button>}>
      <MetaCapiSettingsFields value={value} disabled={false} onChange={setValue} />
    </SectionCard>
    <SectionCard title={t.metaCapi.token} description={t.metaCapi.tokenHelp}>
      <SecretField secretKey="analyticsMetaCapiAccessToken" label={t.metaCapi.token} value={token} maskedPreview={configured ? t.integrations.configured : null}
        labels={{ configured: t.integrations.configured, notConfigured: t.integrations.notConfigured, placeholder: t.integrations.valuePlaceholder, save: t.integrations.save, saving: t.integrations.saving, remove: t.integrations.remove, removing: t.integrations.removing, saved: t.integrations.saved }}
        saving={false} removing={false} saved={configured} onValueChange={setToken} onSave={() => { setToken(''); setConfigured(true); }} onRemove={() => setConfigured(false)} />
    </SectionCard>
  </Stack>;
};
const meta = { title: 'Checkout/Meta CAPI', decorators: [withSurveyPreview], parameters: { locale: 'en', layout: 'fullscreen' }, render: () => <ConsentPreview /> } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const ExpandedFields: Story = { render: () => <ConsentPreview expanded /> };
export const Decided: Story = { render: () => <ConsentPreview decided /> };
export const Settings: Story = { render: () => <SettingsPreview /> };
