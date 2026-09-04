import { Alert, Box, Snackbar, Tooltip } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { actions } from './api.js';
import { LanguageSwitcher } from './components/ui/LanguageSwitcher.js';
import { localizeError, useTranslations, type Language } from './i18n/index.js';

export const useEmailLanguagePreference = () => {
  const queryClient = useQueryClient();
  const me = useQuery(actions.me);
  const update = useMutation({
    ...actions.updateMyProfile,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.meInvalidates());
    },
  });
  const tenant = me.data?.tenant ?? null;
  return {
    stored: tenant?.language ?? null,
    storable: tenant?.memberId != null && (me.data?.impersonation ?? null) === null,
    error: update.error,
    clearError: () => {
      update.reset();
    },
    store: (language: Language | null) => {
      update.mutate({ language });
    },
  };
};

export type EmailLanguagePreference = ReturnType<typeof useEmailLanguagePreference>;

/**
 * The picker doubles as the stored e-mail-language preference, so the failure has
 * to reach the viewer from the panel app bar as well — hence a portalled snackbar
 * instead of an inline alert.
 */
export const EmailLanguagePicker = ({ preference }: { preference: EmailLanguagePreference }) => {
  const t = useTranslations();
  return (
    <>
      <Tooltip title={preference.storable ? '' : t.account.emailLanguage.panelOnly}>
        <Box component="span" sx={{ display: 'inline-flex' }}>
          <LanguageSwitcher
            inline
            onChange={(language) => {
              if (preference.storable) preference.store(language);
            }}
          />
        </Box>
      </Tooltip>
      <Snackbar
        open={preference.error !== null}
        autoHideDuration={6000}
        onClose={preference.clearError}
      >
        <Alert severity="error" data-testid="email-language-error" onClose={preference.clearError}>
          {localizeError(preference.error, t)}
        </Alert>
      </Snackbar>
    </>
  );
};

export const EmailLanguageSwitcher = () => {
  const preference = useEmailLanguagePreference();
  return <EmailLanguagePicker preference={preference} />;
};
