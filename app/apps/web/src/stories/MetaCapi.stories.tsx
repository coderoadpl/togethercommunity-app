import { useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { MetaCapiConfig } from '#core/domain/index.js';
import { FocusCard } from '../components/layout/FocusCard.js';
import { SectionCard } from '../components/layout/index.js';
import { SecretField } from '../components/ui/SecretField.js';
import { MetaCapiConsentDialog } from '../features/checkout/MetaCapiConsentDialog.js';
import { MetaCapiConsent } from '../features/checkout/MetaCapiConsent.js';
import { MetaCapiSettingsFields, type MetaCapiDraft } from '../features/home/settings/MetaCapiSettingsFields.js';
import { useTranslations } from '../i18n/index.js';
import { metaCapiConfig } from '../test/meta-capi-fixtures.js';
import { CardTitle } from '../theme.js';
import { withSurveyPreview } from './page-decorators.js';

const ConsentPreview = ({ expanded = false, decided }: { expanded?: boolean; decided?: Pick<MetaCapiConfig, 'consent' | 'withdrawnAt'> }) => {
  const t = useTranslations();
  const [open, setOpen] = useState(decided === undefined);
  return <Box data-testid="meta-capi-preview">
    <FocusCard eyebrow={t.checkout.successPaidEyebrow} align="start" gutters="tight">
      <Stack useFlexGap spacing="1rem">
        <Stack useFlexGap spacing="1rem">
          <CardTitle variant="h1">{t.checkout.successTitle}</CardTitle>
          {[t.checkout.successBody, `${t.checkout.successWhere} ${t.checkout.successShipping}`, t.checkout.successSpam].map((line) => <Typography key={line} variant="body1">{line}</Typography>)}
        </Stack>
        <Button variant="contained" fullWidth>{t.checkout.backToShop}</Button>
        <Button variant="outlined" fullWidth>{t.checkout.goToLogin}</Button>
        {decided ? <MetaCapiConsent config={{ ...metaCapiConfig, ...decided }} sessionId="cs_live_story" /> : null}
      </Stack>
    </FocusCard>
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
export const Decided: Story = { render: () => <ConsentPreview decided={{ consent: 'granted', withdrawnAt: null }} /> };
export const Declined: Story = { render: () => <ConsentPreview decided={{ consent: 'denied', withdrawnAt: null }} /> };
export const Withdrawn: Story = { render: () => <ConsentPreview decided={{ consent: 'granted', withdrawnAt: '2026-11-05T10:00:00.000Z' }} /> };
export const Settings: Story = { render: () => <SettingsPreview /> };
