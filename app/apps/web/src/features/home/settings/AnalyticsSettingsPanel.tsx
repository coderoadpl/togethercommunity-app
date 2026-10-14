import { useState } from 'react';
import {
  Button,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  OutlinedInput,
  Switch,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { useToastOutcome } from '../../../components/ui/Toast.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';

type AnalyticsDraft = {
  analyticsTagId: string;
  analyticsConsentCookieName: string;
  analyticsConsentCookieValue: string;
  analyticsConsentEvent: string;
  analyticsLoadWithoutConsent: boolean;
};

export const AnalyticsSettingsPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const [draft, setDraft] = useState<AnalyticsDraft | null>(null);
  const value = draft ?? {
    analyticsTagId: settings.data?.settings.analyticsTagId ?? '',
    analyticsConsentCookieName: settings.data?.settings.analyticsConsentCookieName ?? '',
    analyticsConsentCookieValue: settings.data?.settings.analyticsConsentCookieValue ?? '',
    analyticsConsentEvent: settings.data?.settings.analyticsConsentEvent ?? '',
    analyticsLoadWithoutConsent: settings.data?.settings.analyticsLoadWithoutConsent ?? false,
  };
  const update = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
      await queryClient.invalidateQueries(actions.publicPaymentConfig);
      setDraft(null);
    },
  });
  const unavailable = !settings.isSuccess || update.isPending;
  useToastOutcome(update.isSuccess, t.common.saved, update.error === null ? null : localizePanelError(update.error, t));

  return (
    <SectionCard
      title={t.analyticsSettings.heading}
      description={t.analyticsSettings.intro}
      actions={canEdit ? <Button type="submit" variant="contained" disabled={unavailable}>{t.common.save}</Button> : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({
          analyticsTagId: value.analyticsTagId || null,
          analyticsConsentCookieName: value.analyticsConsentCookieName || null,
          analyticsConsentCookieValue: value.analyticsConsentCookieValue || null,
          analyticsConsentEvent: value.analyticsConsentEvent || null,
          analyticsLoadWithoutConsent: value.analyticsLoadWithoutConsent,
        });
      }}
    >
      <FormControl fullWidth>
        <FormLabel htmlFor="analytics-tag-id">{t.analyticsSettings.tagId}</FormLabel>
        <OutlinedInput
          id="analytics-tag-id"
          value={value.analyticsTagId}
          disabled={!canEdit || unavailable}
          inputProps={{ maxLength: 16, 'aria-describedby': 'analytics-tag-id-hint' }}
          onChange={(event) => setDraft({ ...value, analyticsTagId: event.target.value })}
        />
        <FormHelperText id="analytics-tag-id-hint">{t.analyticsSettings.tagIdHint}</FormHelperText>
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="analytics-consent-cookie-name">{t.analyticsSettings.consentCookieName}</FormLabel>
        <OutlinedInput
          id="analytics-consent-cookie-name"
          value={value.analyticsConsentCookieName}
          disabled={!canEdit || unavailable}
          inputProps={{ maxLength: 64, 'aria-describedby': 'analytics-consent-cookie-name-hint' }}
          onChange={(event) => setDraft({ ...value, analyticsConsentCookieName: event.target.value })}
        />
        <FormHelperText id="analytics-consent-cookie-name-hint">{t.analyticsSettings.consentCookieNameHint}</FormHelperText>
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="analytics-consent-cookie-value">{t.analyticsSettings.consentCookieValue}</FormLabel>
        <OutlinedInput
          id="analytics-consent-cookie-value"
          value={value.analyticsConsentCookieValue}
          disabled={!canEdit || unavailable}
          inputProps={{ maxLength: 128, 'aria-describedby': 'analytics-consent-cookie-value-hint' }}
          onChange={(event) => setDraft({ ...value, analyticsConsentCookieValue: event.target.value })}
        />
        <FormHelperText id="analytics-consent-cookie-value-hint">{t.analyticsSettings.consentCookieValueHint}</FormHelperText>
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="analytics-consent-event">{t.analyticsSettings.consentEvent}</FormLabel>
        <OutlinedInput
          id="analytics-consent-event"
          value={value.analyticsConsentEvent}
          disabled={!canEdit || unavailable}
          inputProps={{ maxLength: 64, 'aria-describedby': 'analytics-consent-event-hint' }}
          onChange={(event) => setDraft({ ...value, analyticsConsentEvent: event.target.value })}
        />
        <FormHelperText id="analytics-consent-event-hint">{t.analyticsSettings.consentEventHint}</FormHelperText>
      </FormControl>
      <FormControl>
        <FormControlLabel
          label={t.analyticsSettings.loadWithoutConsent}
          control={(
            <Switch
              checked={value.analyticsLoadWithoutConsent}
              disabled={!canEdit || unavailable}
              slotProps={{ input: { 'aria-describedby': 'analytics-load-without-consent-hint' } }}
              onChange={(_, checked) => setDraft({ ...value, analyticsLoadWithoutConsent: checked })}
            />
          )}
        />
        <FormHelperText id="analytics-load-without-consent-hint">{t.analyticsSettings.loadWithoutConsentHint}</FormHelperText>
      </FormControl>
      {settings.isError ? (
        <StatusView state={{ kind: 'error', message: localizePanelError(settings.error, t), retry: { label: t.common.retry, onRetry: () => void settings.refetch() } }} />
      ) : null}
    </SectionCard>
  );
};
